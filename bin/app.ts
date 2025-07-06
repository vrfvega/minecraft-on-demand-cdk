#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MinecraftOnDemandStack } from "../lib/minecraft-on-demand-cdk-stack";

require("dotenv").config();
const app = new cdk.App();

new MinecraftOnDemandStack(app, "MinecraftOnDemandCdkStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
