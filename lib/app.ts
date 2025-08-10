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
  vpc: networkStack.vpc,
});
storageStack.node.addDependency(networkStack);

const serverOrchestrationStack = new ServerOrchestrationStack(
  app,
  "ServerOrchestrationStack",
  {
    ...commonDeploymentProps,
    vpc: networkStack.vpc,
    securityGroup: networkStack.securityGroup,
    serverHistoryTable: storageStack.serverHistoryTable,
    efsConstruct: storageStack.efsConstruct,
  },
);
serverOrchestrationStack.node.addDependency(networkStack);
serverOrchestrationStack.node.addDependency(storageStack);

const minecraftOnDemandServiceStack = new MinecraftOnDemandServiceStack(
  app,
  "MinecraftOnDemandServiceStack",
  {
    ...commonDeploymentProps,
    serverHistoryTable: storageStack.serverHistoryTable,
    serverConfigurationTable: storageStack.serverConfigurationTable,
    modpackTable: storageStack.modpackTable,
    vpc: networkStack.vpc,
    efsAccessPoint: storageStack.efsConstruct.defaultAccessPoint,
  },
);
minecraftOnDemandServiceStack.node.addDependency(networkStack);
minecraftOnDemandServiceStack.node.addDependency(storageStack);
