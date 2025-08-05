import { Duration, type StackProps } from "aws-cdk-lib";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import {
  Choice,
  Condition,
  DefinitionBody,
  Fail,
  type IChainable,
  IntegrationPattern,
  JsonPath,
  LogLevel,
  Pass,
  StateMachine,
  StateMachineType,
  Wait,
  WaitTime,
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
  minecraftWorldsBucket: IBucket;
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

    const getInstanceId = new CallAwsService(this, "Get InstanceId", {
      service: "ecs",
      action: "describeContainerInstances",
      iamResources: ["*"],
      parameters: {
        Cluster: JsonPath.stringAt("$.detail.clusterArn"),
        ContainerInstances: JsonPath.array(
          JsonPath.stringAt("$.detail.containerInstanceArn"),
        ),
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultSelector: {
        "Ec2InstanceId.$": "$.ContainerInstances[0].Ec2InstanceId",
      },
      resultPath: "$.getInstanceId",
    });

    const syncToS3 = new CallAwsService(this, "Sync to S3", {
      service: "ssm",
      action: "sendCommand",
      iamResources: ["*"],
      parameters: {
        DocumentName: "AWS-RunShellScript",
        InstanceIds: JsonPath.array(
          JsonPath.stringAt("$.getInstanceId.Ec2InstanceId"),
        ),
        Parameters: {
          commands: [
            `
            set -e
            export TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
            export USER_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/tags/instance/userId)
            aws s3 sync /minecraft_data s3://${props.minecraftWorldsBucket.bucketName}/$USER_ID --delete --only-show-errors --no-progress && true
            `,
          ],
        },
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultSelector: {
        "CommandId.$": "$.Command.CommandId",
      },
      resultPath: "$.syncToS3",
    });

    const waitForSync = new Wait(this, "Wait for sync", {
      time: WaitTime.duration(Duration.seconds(10)),
    });

    const getSyncStatus = new CallAwsService(this, "Get sync status", {
      service: "ssm",
      action: "getCommandInvocation",
      iamResources: ["*"],
      parameters: {
        CommandId: JsonPath.stringAt("$.syncToS3.CommandId"),
        InstanceId: JsonPath.stringAt("$.getInstanceId.Ec2InstanceId"),
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultSelector: {
        "Status.$": "$.Status",
      },
      resultPath: "$.getSyncStatus",
    });

    const terminateInstance = new CallAwsService(this, "Terminate instance", {
      service: "ec2",
      action: "terminateInstances",
      iamResources: ["*"],
      parameters: {
        InstanceIds: JsonPath.array(
          JsonPath.stringAt("$.getInstanceId.Ec2InstanceId"),
        ),
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultPath: JsonPath.DISCARD,
    });

    const syncFailed = new Fail(this, "Sync failed", {
      cause: "SSM Command Failed",
      error: "The S3 sync command did not return Success.",
    });

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

    const extractDdbKeys = new Pass(this, "Extract DDB Keys", {
      parameters: {
        "serverId.$": "$.getServerTaskTags.Tags[?(@.Key=='serverId')].Value",
        "startedAt.$": "$.getServerTaskTags.Tags[?(@.Key=='startedAt')].Value",
      },
      resultPath: "$.extractDdbKeys",
    });

    const updateDdbItem = new DynamoUpdateItem(this, "Update DDB item", {
      table: props.serverHistoryTable,
      key: {
        serverId: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.extractDdbKeys.serverId[0]"),
        ),
        startedAt: DynamoAttributeValue.fromNumber(
          JsonPath.numberAt("$.extractDdbKeys.startedAt[0]"),
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

    const successChain = terminateInstance
      .next(getServerTaskTags)
      .next(getCurrentTime)
      .next(extractDdbKeys)
      .next(updateDdbItem);

    const isSyncComplete = new Choice(this, "Is sync complete?")
      .when(
        Condition.stringEquals("$.getSyncStatus.Status", "Success"),
        successChain,
      )
      .when(
        Condition.or(
          Condition.stringEquals("$.getSyncStatus.Status", "Pending"),
          Condition.stringEquals("$.getSyncStatus.Status", "InProgress"),
          Condition.stringEquals("$.getSyncStatus.Status", "Delayed"),
        ),
        waitForSync,
      )
      .otherwise(syncFailed);

    this.definition = getInstanceId
      .next(syncToS3)
      .next(waitForSync)
      .next(getSyncStatus)
      .next(isSyncComplete);

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
          "ecs:DescribeContainerInstances",
          "ecs:DescribeTasks",
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
          "ec2:TerminateInstances",
        ],
        resources: ["*"],
      }),
    );
  }
}
