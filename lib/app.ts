#!/usr/bin/env node
import type { StackProps } from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import dotenv from "dotenv";
import { MinecraftOnDemandServiceStack } from "./stacks/minecraftOnDemandServiceStack.js";
import { NetworkStack } from "./stacks/networkStack.js";
import { ServerOrchestrationStack } from "./stacks/serverOrchestrationStack.js";
import { StorageStack } from "./stacks/storageStack.js";

dotenv.config();
const app = new cdk.App();

export interface CommonDeploymentProps extends StackProps {}

const commonDeploymentProps: CommonDeploymentProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
};

const networkStack = new NetworkStack(app, "NetworkStack", {
  ...commonDeploymentProps,
});

const storageStack = new StorageStack(app, "StorageStack", {
  ...commonDeploymentProps,
});

const minecraftOnDemandServiceStack = new MinecraftOnDemandServiceStack(
  app,
  "MinecraftOnDemandServiceStack",
  {
    ...commonDeploymentProps,
    provisioningHistoryTable: storageStack.provisioningHistoryTable,
  },
);
minecraftOnDemandServiceStack.node.addDependency(storageStack);

const serverOrchestrationStack = new ServerOrchestrationStack(
  app,
  "ServerOrchestrationStack",
  {
    ...commonDeploymentProps,
    vpc: networkStack.vpc,
    securityGroup: networkStack.securityGroup,
    provisioningHistoryTable: storageStack.provisioningHistoryTable,
  },
);
serverOrchestrationStack.node.addDependency(networkStack);
serverOrchestrationStack.node.addDependency(storageStack);
