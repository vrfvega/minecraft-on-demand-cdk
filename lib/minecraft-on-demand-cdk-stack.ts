import * as cdk from 'aws-cdk-lib';
import {RemovalPolicy} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Cors, RestApi} from "aws-cdk-lib/aws-apigateway";
import {AttributeType, Billing, TableV2} from "aws-cdk-lib/aws-dynamodb";


export class MinecraftOnDemandCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new RestApi(this, "MinecraftOnDemandApi", {
      restApiName: "Minecraft On Demand API",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST"],
      }
    });

    const provisioningHistory = new TableV2(this, "ProvisioningHistory", {
      tableName: "ProvisioningHistory",
      partitionKey: { name: "executionId", type: AttributeType.STRING},
      sortKey: { name: "timestamp", type: AttributeType.NUMBER},
      billing: Billing.onDemand(),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN
    })
  }
}
