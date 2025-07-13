import path from "node:path";
import {Stack, type StackProps} from "aws-cdk-lib";
import {Cors, LambdaIntegration, RestApi} from "aws-cdk-lib/aws-apigateway";
import type {ITableV2} from "aws-cdk-lib/aws-dynamodb";
import {Architecture, Runtime} from "aws-cdk-lib/aws-lambda";
import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs";
import type {Construct} from "constructs";

export interface MinecraftOnDemandServiceStackProps extends StackProps {
  provisioningHistoryTable: ITableV2;
}

export class MinecraftOnDemandServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: MinecraftOnDemandServiceStackProps) {
    super(scope, id, props);
    const api = new RestApi(this, "MinecraftOnDemandApi", {
      restApiName: "MinecraftOnDemandAPI",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST"],
      },
    });

    const serverConfigurationHandler = new NodejsFunction(
      this,
      "ServerConfigurationHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        entry: path.join(
          __dirname,
          "../lambdas/server_configuration_handler/index.ts",
        ),
        environment: { TABLE_NAME: props.provisioningHistoryTable.tableName },
        bundling: {
          minify: true,
          nodeModules: ["zod"],
          externalModules: ['@aws-sdk/*'],
        },
      },
    );

    props.provisioningHistoryTable.grantWriteData(serverConfigurationHandler);
    const servers = api.root.addResource("servers");
    servers.addMethod(
      "POST",
      new LambdaIntegration(serverConfigurationHandler),
    );
  }
}
