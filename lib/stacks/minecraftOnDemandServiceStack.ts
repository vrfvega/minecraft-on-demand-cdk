import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import {
  Cors,
  LambdaIntegration,
  RestApi,
  TokenAuthorizer,
} from "aws-cdk-lib/aws-apigateway";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";
import { USER_ID_INDEX_NAME } from "../constants.js";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";

export interface MinecraftOnDemandServiceStackProps extends StackProps {
  serverHistoryTable: ITableV2;
  clusterArn: string;
}

export class MinecraftOnDemandServiceStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: MinecraftOnDemandServiceStackProps,
  ) {
    super(scope, id, props);

    const authorizerHandler = new NodejsFunction(
      this,
      "SupabaseAuthorizerHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/supabaseAuthorizerHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          SUPABASE_LEGACY_JWT_SECRET: process.env.SUPABASE_LEGACY_JWT_SECRET!,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          externalModules: ["@aws-sdk/*"],
        },
      },
    );

    const tokenAuthorizer = new TokenAuthorizer(this, "TokenAuthorizer", {
      handler: authorizerHandler,
      resultsCacheTtl: Duration.minutes(0),
    });

    const api = new RestApi(this, "MinecraftOnDemandApi", {
      restApiName: "MinecraftOnDemandApi",
      defaultMethodOptions: {
        authorizer: tokenAuthorizer,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
    });

    const serversResource = api.root.addResource("servers");
    const serverIdResource = serversResource.addResource("{serverId}");

    const serverRequestValidator = new NodejsFunction(
      this,
      "ServerRequestValidatorHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/serverRequestValidatorHandler.ts",
          import.meta.url,
        ).pathname,
        environment: { TABLE_NAME: props.serverHistoryTable.tableName },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );

    props.serverHistoryTable.grantWriteData(serverRequestValidator);

    serversResource.addMethod(
      "POST",
      new LambdaIntegration(serverRequestValidator, { proxy: true }),
    );

    const getServerStatusHandler = new NodejsFunction(
      this,
      "GetServerStatusHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/getServerStatusHandler.ts",
          import.meta.url,
        ).pathname,
        environment: { TABLE_NAME: props.serverHistoryTable.tableName },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.serverHistoryTable.grantReadData(getServerStatusHandler);

    serverIdResource
      .addMethod(
        "GET",
        new LambdaIntegration(getServerStatusHandler, { proxy: true }),
      );

    const getServerHistoryHandler = new NodejsFunction(
      this,
      "GetServerHistoryHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/getServerHistoryHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          TABLE_NAME: props.serverHistoryTable.tableName,
          USER_ID_INDEX_NAME: USER_ID_INDEX_NAME,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.serverHistoryTable.grantReadData(getServerHistoryHandler);
    serversResource.addMethod(
      "GET",
      new LambdaIntegration(getServerHistoryHandler, { proxy: true }),
    );

    const stopServerTaskHandler = new NodejsFunction(
      this,
      "StopServerTaskHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/stopServerTaskHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          TABLE_NAME: props.serverHistoryTable.tableName,
          CLUSTER_ARN: props.clusterArn
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    stopServerTaskHandler.addToRolePolicy(
      new PolicyStatement({
        actions: ["ecs:stopTask"],
        resources: ["*"]
      })
    )
    props.serverHistoryTable.grantReadData(stopServerTaskHandler);

    serverIdResource
      .addMethod(
        "DELETE",
        new LambdaIntegration(stopServerTaskHandler, { proxy: true }),
      );
  }
}
