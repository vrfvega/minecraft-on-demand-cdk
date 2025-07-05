import * as cdk from "aws-cdk-lib";
import { RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Cors, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { AttributeType, Billing, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import path from "path";

export class MinecraftOnDemandCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const api = new RestApi(this, "MinecraftOnDemandApi", {
      restApiName: "Minecraft On Demand API",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST"],
      },
    });

    const provisioningHistory = new TableV2(this, "ProvisioningHistory", {
      tableName: "ProvisioningHistory",
      partitionKey: { name: "executionId", type: AttributeType.STRING },
      sortKey: { name: "timestamp", type: AttributeType.NUMBER },
      billing: Billing.onDemand(),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const testLambda = new NodejsFunction(this, "ServerPayloadValidation", {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      entry: path.join(
        __dirname,
        "../lambda/server_payload_validation/index.ts",
      ),
      environment: { TABLE_NAME: provisioningHistory.tableName },
      bundling: {
        minify: true,
        nodeModules: ["zod"],
      },
    });

    provisioningHistory.grantWriteData(testLambda);
    let servers = api.root.addResource("servers");
    servers.addMethod("POST", new LambdaIntegration(testLambda));
  }
}
