#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MinecraftOnDemandCdkStack } from '../lib/minecraft-on-demand-cdk-stack';

require('dotenv').config()
const app = new cdk.App();

new MinecraftOnDemandCdkStack(app, 'MinecraftOnDemandCdkStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});