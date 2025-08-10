import { Duration, type StackProps } from "aws-cdk-lib";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import {
  DefinitionBody,
  type IChainable,
  IntegrationPattern,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  StateMachineType,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  CallAwsService,
  DynamoAttributeValue,
  DynamoUpdateItem,
  LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

export interface ServerTeardownOrchestratorProps extends StackProps {
  serverHistoryTable: ITableV2;
}

export class ServerTeardownOrchestratorConstruct extends Construct {
  readonly definition: IChainable;
  readonly stateMachine: StateMachine;

  constructor(
    scope: Construct,
    id: string,
    props: ServerTeardownOrchestratorProps,
  ) {
    super(scope, id);

    const getServerTaskTags = new CallAwsService(this, "Get server task tags", {
      service: "ecs",
      action: "describeTasks",
      iamResources: ["*"],
      parameters: {
        Cluster: JsonPath.stringAt("$.detail.clusterArn"),
        Tasks: JsonPath.array(JsonPath.stringAt("$.detail.taskArn")),
        Include: ["TAGS"],
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultSelector: {
        "Tags.$": "$.Tasks[0].Tags",
      },
      resultPath: "$.getServerTaskTags",
    });

    const extractTagValues = new Pass(this, "Extract tag values", {
      parameters: {
        "serverId.$": "$.getServerTaskTags.Tags[?(@.Key=='serverId')].Value",
        "startedAt.$": "$.getServerTaskTags.Tags[?(@.Key=='startedAt')].Value",
        "taskDefinitionArn.$":
          "$.getServerTaskTags.Tags[?(@.Key=='taskDefinitionArn')].Value",
        "accessPointId.$":
          "$.getServerTaskTags.Tags[?(@.Key=='accessPointId')].Value",
      },
      resultPath: "$.extractTagValues",
    });

    const deleteAccessPoint = new CallAwsService(this, "Delete access point", {
      service: "efs",
      action: "deleteAccessPoint",
      iamResources: ["*"],
      parameters: {
        AccessPointId: JsonPath.stringAt("$.extractTagValues.accessPointId[0]"),
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultPath: "$.deleteAccessPoint",
    });

    const deregisterTaskDefinition = new CallAwsService(
      this,
      "Deregister task definition",
      {
        service: "ecs",
        action: "deregisterTaskDefinition",
        iamResources: ["*"],
        parameters: {
          TaskDefinition: JsonPath.stringAt(
            "$.extractTagValues.taskDefinitionArn[0]",
          ),
        },
        integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
        resultPath: "$.deregisterTaskDefinition",
      },
    );

    const deleteTaskDefinition = new CallAwsService(
      this,
      "Delete task definition",
      {
        service: "ecs",
        action: "deleteTaskDefinitions",
        iamResources: ["*"],
        parameters: {
          TaskDefinitions: JsonPath.array(
            JsonPath.stringAt("$.extractTagValues.taskDefinitionArn[0]"),
          ),
        },
        integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
        resultPath: "$.deleteTaskDefinition",
      },
    );

    const getCurrentTimeHandler = new NodejsFunction(
      this,
      "GetCurrentTimeHandler",
      {
        description: "Returns current time in UNIX epoch format",
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/getCurrentTimeHandler.ts",
          import.meta.url,
        ).pathname,
        bundling: {
          minify: true,
          externalModules: ["@aws-sdk/*"],
        },
      },
    );

    const getCurrentTime = new LambdaInvoke(this, "Get current time", {
      lambdaFunction: getCurrentTimeHandler,
      payloadResponseOnly: true,
      resultPath: "$.getCurrentTime",
    });

    const updateDdbItem = new DynamoUpdateItem(this, "Update DDB item", {
      table: props.serverHistoryTable,
      key: {
        serverId: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.extractTagValues.serverId[0]"),
        ),
        startedAt: DynamoAttributeValue.fromNumber(
          JsonPath.numberAt("$.extractTagValues.startedAt[0]"),
        ),
      },
      updateExpression: "SET serverStatus = :ss, endedAt = :ea",
      expressionAttributeValues: {
        ":ss": DynamoAttributeValue.fromString("STOPPED"),
        ":ea": DynamoAttributeValue.numberFromString(
          JsonPath.stringAt("$.getCurrentTime.CurrentTime"),
        ),
      },
      resultPath: JsonPath.DISCARD,
    });

    this.definition = getServerTaskTags
      .next(extractTagValues)
      .next(deleteAccessPoint)
      .next(deregisterTaskDefinition)
      .next(deleteTaskDefinition)
      .next(getCurrentTime)
      .next(updateDdbItem);

    this.stateMachine = new StateMachine(this, `${id}-StateMachine`, {
      stateMachineName: `${id}`,
      definitionBody: DefinitionBody.fromChainable(this.definition),
      stateMachineType: StateMachineType.STANDARD,
      timeout: Duration.minutes(1),
      logs: {
        destination: new LogGroup(this, `${id}-id`, {
          logGroupName: `/aws/states/${id}`,
        }),
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
    });

    this.stateMachine.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "ecs:DescribeTasks",
          "ecs:DeregisterTaskDefinition",
          "ecs:DeleteTaskDefinitions",
          "efs:DeleteAccessPoint",
        ],
        resources: ["*"],
      }),
    );
  }
}
