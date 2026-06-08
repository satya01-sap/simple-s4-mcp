import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { retrieveJwt, decodeJwt } from "@sap-cloud-sdk/connectivity";
import { executeHttpRequest } from "@sap-cloud-sdk/http-client";
import { createLogger } from "@sap-cloud-sdk/util";
import { z } from "zod";
import type { Request, Response } from "express";

const logger = createLogger("s4-bp-mcp");

const app = express();
app.use(express.json());

// Business Partner field types from API_BUSINESS_PARTNER
interface BusinessPartner {
  BusinessPartner: string;
  BusinessPartnerFullName: string;
  BusinessPartnerType: string;
  SearchTerm1: string;
  CreatedByUser: string;
  CreationDate: string;
  LastChangedByUser: string;
  LastChangeDate: string;
  IsNaturalPerson: string;
  BusinessPartnerCategory: string;
}

interface ODataResponse {
  d: {
    results?: BusinessPartner[];
    BusinessPartner?: string;
    BusinessPartnerFullName?: string;
    BusinessPartnerType?: string;
    SearchTerm1?: string;
    CreatedByUser?: string;
    CreationDate?: string;
    LastChangedByUser?: string;
    LastChangeDate?: string;
    IsNaturalPerson?: string;
    BusinessPartnerCategory?: string;
  };
}

// Destination name configured in BTP cockpit (OAuth2SAMLBearerAssertion, OnPremise)
const DESTINATION_NAME = process.env["DESTINATION_NAME"] ?? "S4_ONPREM_PP";

async function getBusinessPartner(
  supplierId: string,
  userJwt: string
): Promise<BusinessPartner | null> {
  const response = await executeHttpRequest(
    { destinationName: DESTINATION_NAME, jwt: userJwt },
    {
      method: "GET",
      url: `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('${encodeURIComponent(supplierId)}')`,
      headers: {
        Accept: "application/json",
        "sap-client": process.env["SAP_CLIENT"] ?? "100",
      },
    }
  );

  const body = response.data as ODataResponse;
  if (!body?.d) return null;

  // OData v2 single entity is directly in d
  const d = body.d;
  return {
    BusinessPartner: d.BusinessPartner ?? "",
    BusinessPartnerFullName: d.BusinessPartnerFullName ?? "",
    BusinessPartnerType: d.BusinessPartnerType ?? "",
    SearchTerm1: d.SearchTerm1 ?? "",
    CreatedByUser: d.CreatedByUser ?? "",
    CreationDate: d.CreationDate ?? "",
    LastChangedByUser: d.LastChangedByUser ?? "",
    LastChangeDate: d.LastChangeDate ?? "",
    IsNaturalPerson: d.IsNaturalPerson ?? "",
    BusinessPartnerCategory: d.BusinessPartnerCategory ?? "",
  };
}

function formatODataDate(odataDate: string): string {
  // OData v2 dates: /Date(1234567890000)/
  const match = /\/Date\((\d+)\)\//.exec(odataDate);
  if (match?.[1]) {
    return new Date(parseInt(match[1])).toISOString().split("T")[0] ?? odataDate;
  }
  return odataDate;
}

// MCP endpoint — one server instance per request (stateless)
app.post("/mcp", async (req: Request, res: Response) => {
  const userJwt = retrieveJwt(req);

  if (!userJwt) {
    res.status(401).json({ error: "Missing Authorization header. Ensure the App Router is forwarding the JWT." });
    return;
  }

  let userIdentity = "unknown";
  try {
    const claims = decodeJwt(userJwt);
    userIdentity = (claims["email"] as string | undefined)
      ?? (claims["user_name"] as string | undefined)
      ?? (claims["sub"] as string | undefined)
      ?? "unknown";
  } catch {
    // non-fatal — we still have the JWT for principal propagation
  }

  const server = new McpServer({
    name: "s4-business-partner",
    version: "1.0.0",
  });

  server.registerTool(
    "get_business_partner",
    {
      description:
        "Retrieve SAP Business Partner details for a given supplier ID from S/4HANA on-premise. " +
        "Returns partner name, type, category, creation/change audit fields.",
      inputSchema: {
        supplier_id: z
          .string()
          .min(1)
          .max(10)
          .describe("SAP Business Partner number (up to 10 digits, e.g. '0000100042')"),
      },
    },
    async ({ supplier_id }) => {
      logger.info({
        event: "tool_invoked",
        tool: "get_business_partner",
        user: userIdentity,
        supplierId: supplier_id,
        timestamp: new Date().toISOString(),
      });

      let bp: BusinessPartner | null = null;
      let errorMessage: string | undefined;

      try {
        bp = await getBusinessPartner(supplier_id, userJwt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({
          event: "tool_error",
          tool: "get_business_partner",
          user: userIdentity,
          supplierId: supplier_id,
          error: msg,
        });
        errorMessage = msg;
      }

      if (errorMessage) {
        return {
          content: [{ type: "text", text: `Error fetching Business Partner: ${errorMessage}` }],
          isError: true,
        };
      }

      if (!bp) {
        return {
          content: [{ type: "text", text: `No Business Partner found for supplier ID: ${supplier_id}` }],
        };
      }

      logger.info({
        event: "tool_success",
        tool: "get_business_partner",
        user: userIdentity,
        supplierId: supplier_id,
      });

      const text = [
        `Business Partner: ${bp.BusinessPartner}`,
        `Full Name:        ${bp.BusinessPartnerFullName}`,
        `Type:             ${bp.BusinessPartnerType}`,
        `Category:         ${bp.BusinessPartnerCategory}`,
        `Search Term:      ${bp.SearchTerm1}`,
        `Natural Person:   ${bp.IsNaturalPerson === "X" ? "Yes" : "No"}`,
        `Created By:       ${bp.CreatedByUser}`,
        `Creation Date:    ${formatODataDate(bp.CreationDate)}`,
        `Last Changed By:  ${bp.LastChangedByUser}`,
        `Last Change Date: ${formatODataDate(bp.LastChangeDate)}`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await server.close();
  }
});

// Health check for CF
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const port = parseInt(process.env["PORT"] ?? "8080", 10);
app.listen(port, () => {
  logger.info(`S4 Business Partner MCP server listening on port ${port}`);
});
