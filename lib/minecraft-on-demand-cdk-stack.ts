import path from "node:path";
import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Cors, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { AttributeType, Billing, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";

export class MinecraftOnDemandStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
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
    const servers = api.root.addResource("servers");
    servers.addMethod("POST", new LambdaIntegration(testLambda));
  }
}
