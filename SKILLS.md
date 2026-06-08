---
name: creare-simple-mcp
description: Create a simple MCP servide for SAP S/4 HANA Business Patrtner. It must have only tool to read the specific business partner data. That will be deployed in SAP BTP. 
---

# Quick start


`
## Create a new directory for our project
mkdir weather
cd weather

## Initialize a new npm project
npm init -y

## Install dependencies
npm install @modelcontextprotocol/sdk zod@3
npm install -D @types/node typescript

## Create our files
mkdir src
touch src/index.ts

## Initialise the tsconfig
tsc --init

## Add node types for dev
npm add @types/node -D

`

## Use SAP Cloud SDK to connec to S/4 destination

- Use the destination name **S4PUBLIC_CLOUD** the destinatio auth type is **Principal Propogation** 

- Give a provision to login to user when MCP tool is connecting to S/4, redire to auth url 

- Use SAP Cloude SDK to connec send request to S/4 and do not use any other liberary to make the call to S/4

## Make the MCP server extensible 

- In future more tools can be aded so make about scalling of this proejct

- make tools definitation clear 


## Add tools for local testing

- Add mcp debugging npm package.







