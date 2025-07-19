import {Duration, Stack, type StackProps} from "aws-cdk-lib";
import { Cors, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";

export interface MinecraftOnDemandServiceStackProps extends StackProps {
  provisioningHistoryTable: ITableV2;
}

export class MinecraftOnDemandServiceStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: MinecraftOnDemandServiceStackProps,
  ) {
    super(scope, id, props);
    const api = new RestApi(this, "MinecraftOnDemandApi", {
      restApiName: "MinecraftOnDemandAPI",
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
    });

    const serverConfigurationHandler = new NodejsFunction(
      this,
      "ServerConfigurationHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/server_configuration_handler/index.ts",
          import.meta.url,
        ).pathname,
        environment: { TABLE_NAME: props.provisioningHistoryTable.tableName },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );

    props.provisioningHistoryTable.grantWriteData(serverConfigurationHandler);
    const servers = api.root.addResource("servers");
    servers.addMethod(
      "POST",
      new LambdaIntegration(serverConfigurationHandler, { proxy: true }),
    );

    const serverStatusFetchHandler = new NodejsFunction(
      this,
      "ServerStatusFetchHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/server_status_fetch_handler/index.ts",
          import.meta.url,
        ).pathname,
        environment: { TABLE_NAME: props.provisioningHistoryTable.tableName },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.provisioningHistoryTable.grantReadData(serverStatusFetchHandler);
    servers
      .addResource("{serverId}")
      .addMethod(
        "GET",
        new LambdaIntegration(serverStatusFetchHandler, { proxy: true }),
      );
  }
}
