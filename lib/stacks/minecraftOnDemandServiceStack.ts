import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import {
  Cors,
  LambdaIntegration,
  RestApi,
  TokenAuthorizer,
} from "aws-cdk-lib/aws-apigateway";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import type { IVpc } from "aws-cdk-lib/aws-ec2";
import type { IAccessPoint } from "aws-cdk-lib/aws-efs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  FileSystem as LambdaFileSystem,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";
import { FARGATE_CLUSTER_NAME, USER_ID_INDEX_NAME } from "../constants.js";

export interface MinecraftOnDemandServiceStackProps extends StackProps {
  serverHistoryTable: ITableV2;
  serverConfigurationTable: ITableV2;
  modpackTable: ITableV2;
  vpc: IVpc;
  efsAccessPoint: IAccessPoint;
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
      minimumCompressionSize: 2048,
      defaultMethodOptions: {
        authorizer: tokenAuthorizer,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
    });

    const serversResource = api.root.addResource("servers");
    const serversConfigurationResource = api.root.addResource("server-configuration");
    const storageResource = api.root.addResource("storage");
    const serverIdResource = serversResource.addResource("{serverId}");
    const modpacksResource = api.root.addResource("modpacks");
    const modpackIdResource = modpacksResource.addResource("{modpackId}");


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
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          SERVER_HISTORY_TABLE_NAME: props.serverHistoryTable.tableName,
          SERVER_CONFIGURATIONS_TABLE_NAME:
            props.serverConfigurationTable.tableName,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.serverHistoryTable.grantWriteData(serverRequestValidator);
    props.serverConfigurationTable.grantReadData(serverRequestValidator);

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
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.serverHistoryTable.tableName,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.serverHistoryTable.grantReadData(getServerStatusHandler);

    serverIdResource.addMethod(
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
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.serverHistoryTable.tableName,
          USER_ID_INDEX_NAME: USER_ID_INDEX_NAME,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: [
            "@middy/core",
            "@middy/http-cors",
            "@ctrl/ts-base32",
            "uint8array-extras",
          ],
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
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.serverHistoryTable.tableName,
          CLUSTER_ARN: `arn:aws:ecs:${Stack.of(this).region}:${Stack.of(this).account}:cluster/${FARGATE_CLUSTER_NAME}`,
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
        resources: ["*"],
      }),
    );
    props.serverHistoryTable.grantReadWriteData(stopServerTaskHandler);

    serverIdResource.addMethod(
      "DELETE",
      new LambdaIntegration(stopServerTaskHandler, { proxy: true }),
    );

    const getServerConfigurationHandler = new NodejsFunction(
      this,
      "GetServerConfigurationHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/getServerConfigurationHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.serverConfigurationTable.tableName,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.serverConfigurationTable.grantReadData(getServerConfigurationHandler);

    serversConfigurationResource.addMethod(
      "GET",
      new LambdaIntegration(getServerConfigurationHandler, { proxy: true }),
    );

    const putServerConfigurationHandler = new NodejsFunction(
      this,
      "PutServerConfigurationHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/putServerConfigurationHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.serverConfigurationTable.tableName,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.serverConfigurationTable.grantWriteData(
      putServerConfigurationHandler,
    );

    serversConfigurationResource.addMethod(
      "PUT",
      new LambdaIntegration(putServerConfigurationHandler, { proxy: true }),
    );

    const deleteServerStorageHandler = new NodejsFunction(
      this,
      "DeleteServerStorageHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/deleteServerStorageHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          MOUNT_PATH: "/mnt/efs",
        },
        vpc: props.vpc,
        filesystem: LambdaFileSystem.fromEfsAccessPoint(
          props.efsAccessPoint,
          "/mnt/efs",
        ),
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );

    storageResource.addMethod(
      "DELETE",
      new LambdaIntegration(deleteServerStorageHandler, { proxy: true }),
    );

    const getModpacksHandler = new NodejsFunction(
      this,
      "GetModpacksHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/getModpacksHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.modpackTable.tableName,
          USER_ID_INDEX_NAME: USER_ID_INDEX_NAME,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.modpackTable.grantReadData(getModpacksHandler);
    modpacksResource.addMethod(
      "GET",
      new LambdaIntegration(getModpacksHandler, { proxy: true }),
    );

    const postModpackHandler = new NodejsFunction(
      this,
      "PostModpackHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/postModpackHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.modpackTable.tableName,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.modpackTable.grantWriteData(postModpackHandler);
    modpacksResource.addMethod(
      "POST",
      new LambdaIntegration(postModpackHandler, { proxy: true }),
    );

    const getModpackByIdHandler = new NodejsFunction(
      this,
      "GetModpackByIdHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/getModpackByIdHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.modpackTable.tableName,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.modpackTable.grantReadData(getModpackByIdHandler);
    modpackIdResource.addMethod(
      "GET",
      new LambdaIntegration(getModpackByIdHandler, { proxy: true }),
    );

    const putModpackByIdHandler = new NodejsFunction(
      this,
      "PutModpackByIdHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/putModpackByIdHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.modpackTable.tableName,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.modpackTable.grantReadWriteData(putModpackByIdHandler);
    modpackIdResource.addMethod(
      "PUT",
      new LambdaIntegration(putModpackByIdHandler, { proxy: true }),
    );

    const deleteModpackByIdHandler = new NodejsFunction(
      this,
      "DeleteModpackByIdHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/deleteModpackByIdHandler.ts",
          import.meta.url,
        ).pathname,
        environment: {
          POWERTOOLS_LOGGER_LOG_EVENT: "true",
          TABLE_NAME: props.modpackTable.tableName,
        },
        bundling: {
          minify: true,
          format: OutputFormat.ESM,
          nodeModules: ["zod", "@middy/core", "@middy/http-cors"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    props.modpackTable.grantReadWriteData(deleteModpackByIdHandler);
    modpackIdResource.addMethod(
      "DELETE",
      new LambdaIntegration(deleteModpackByIdHandler, { proxy: true }),
    );
  }
}
