import {
  DynamicInput,
  Filter,
  FilterPattern,
  InputTransformation,
  Pipe,
} from "@aws-cdk/aws-pipes-alpha";
import {
  DynamoDBSource,
  DynamoDBStartingPosition,
} from "@aws-cdk/aws-pipes-sources-alpha";
import {
  SfnStateMachine,
  StateMachineInvocationType,
} from "@aws-cdk/aws-pipes-targets-alpha";
import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import type { ISecurityGroup, IVpc } from "aws-cdk-lib/aws-ec2";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  Choice,
  Condition,
  DefinitionBody,
  IntegrationPattern,
  JsonPath,
  Pass,
  StateMachine,
  TaskInput,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  CallAwsService,
  DynamoAttributeValue,
  DynamoUpdateItem,
  LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import type { Construct } from "constructs";
import { ComputeConstruct } from "../constructs/ComputeConstruct.js";

export interface ServerOrchestrationStackProps extends StackProps {
  vpc: IVpc;
  securityGroup: ISecurityGroup;
  provisioningHistoryTable: ITableV2;
}

export class ServerOrchestrationStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: ServerOrchestrationStackProps,
  ) {
    super(scope, id, props);

    const computeConstruct = new ComputeConstruct(this, "Compute", {
      vpc: props.vpc,
    });

    const unwrapInput = new Pass(this, "UnwrapInput", {
      inputPath: "$[0]",
      resultPath: "$",
    });

    const runInstance = new CallAwsService(this, "Run EC2 instance", {
      service: "ec2",
      action: "runInstances",
      iamResources: ["*"],
      parameters: {
        ImageId: computeConstruct.ecsOptimizedAmiArm64,
        InstanceType: "t4g.small",
        MinCount: 1,
        MaxCount: 1,
        SubnetId: props.vpc.publicSubnets.at(0)!.subnetId,
        SecurityGroupIds: [props.securityGroup.securityGroupId],
        IamInstanceProfile: {
          Name: computeConstruct.instanceProfile.instanceProfileName,
        },
        UserData: JsonPath.base64Encode(computeConstruct.userData.render()),
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultSelector: {
        "InstanceId.$": "$.Instances[0].InstanceId",
      },
      resultPath: "$.runInstanceResult",
    });

    const instanceCheckerHandler = new NodejsFunction(
      this,
      "InstanceCheckerHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/instance_checker_handler/index.ts",
          import.meta.url,
        ).pathname,
        bundling: {
          minify: true,
          nodeModules: ["zod"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    instanceCheckerHandler.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "ecs:ListContainerInstances",
          "ecs:DescribeContainerInstances",
          "ec2:DescribeInstances",
        ],
        resources: ["*"],
      }),
    );

    const waitInLoop = new Wait(this, "Wait between polls", {
      time: WaitTime.duration(Duration.seconds(10)),
    });

    const checkInstanceStatus = new LambdaInvoke(
      this,
      "Check instance status",
      {
        lambdaFunction: instanceCheckerHandler,
        payloadResponseOnly: true,
        payload: TaskInput.fromObject({
          clusterName: computeConstruct.cluster.clusterName,
          ec2InstanceId: JsonPath.stringAt("$.runInstanceResult.InstanceId"),
        }),
        resultPath: "$.checkerResult",
      },
    );

    const runServerTask = new CallAwsService(this, "Run server task", {
      service: "ecs",
      action: "runTask",
      iamResources: ["*"],
      parameters: {
        Cluster: computeConstruct.cluster.clusterName,
        TaskDefinition: computeConstruct.taskDefinition.taskDefinitionArn,
        LaunchType: "EC2",
        Group: "minecraft-on-demand",
        PlacementConstraints: [
          {
            Type: "memberOf",
            Expression: JsonPath.format(
              "ec2InstanceId == {}",
              JsonPath.stringAt("$.runInstanceResult.InstanceId"),
            ),
          },
        ],
        Overrides: {
          ContainerOverrides: [
            {
              Name: computeConstruct.containerDefinition.containerName,
              Environment: [
                {
                  Name: "TYPE",
                  Value: JsonPath.stringAt("$.serverConfig.type"),
                },
                {
                  Name: "VERSION",
                  Value: JsonPath.stringAt("$.serverConfig.version"),
                },
              ],
            },
          ],
        },
        Tags: [
          { Key: "serverId", Value: JsonPath.stringAt("$.serverId") },
          { Key: "startedAt", Value: JsonPath.numberAt("$.startedAt") },
        ],
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultPath: "$.runServerTaskResult",
    });

    const updateDdbItem = new DynamoUpdateItem(this, "Update DDB item", {
      table: props.provisioningHistoryTable,
      key: {
        serverId: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.serverId"),
        ),
        startedAt: DynamoAttributeValue.fromNumber(
          JsonPath.numberAt("$.startedAt"),
        ),
      },
      updateExpression:
        "SET serverStatus = :ss, publicIp = :ip, containerInstanceArn = :cia, taskArn = :ta, instanceId = :ii",
      expressionAttributeValues: {
        ":ss": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.runServerTaskResult.Tasks[0].DesiredStatus"),
        ),
        ":ip": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.checkerResult.publicIp"),
        ),
        ":cia": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.checkerResult.containerInstanceArn"),
        ),
        ":ta": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.runServerTaskResult.Tasks[0].TaskArn"),
        ),
        ":ii": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.runInstanceResult.InstanceId"),
        ),
      },
      resultPath: JsonPath.DISCARD,
    });

    const serverOrchestrationStateMachine = new StateMachine(
      this,
      "ServerOrchestrator",
      {
        definitionBody: DefinitionBody.fromChainable(
          unwrapInput
            .next(runInstance)
            .next(waitInLoop)
            .next(checkInstanceStatus)
            .next(
              new Choice(this, "Is instance ready?")
                .when(
                  Condition.booleanEquals(
                    "$.checkerResult.instanceIsReady",
                    true,
                  ),
                  runServerTask.next(updateDdbItem),
                )
                .otherwise(waitInLoop),
            ),
        ),
      },
    );
    serverOrchestrationStateMachine.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["ecs:TagResource"],
        resources: ["*"],
      }),
    );
    serverOrchestrationStateMachine.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [
          computeConstruct.instanceRole.roleArn,
          computeConstruct.taskDefinition.executionRole!.roleArn,
          computeConstruct.taskDefinition.taskRole.roleArn,
        ],
      }),
    );
    props.provisioningHistoryTable.grantWriteData(
      serverOrchestrationStateMachine,
    );

    const pipeRole = new Role(this, "PipeRole", {
      assumedBy: new ServicePrincipal("pipes.amazonaws.com"),
    });
    pipeRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams",
        ],
        resources: [props.provisioningHistoryTable.tableArn],
      }),
    );
    pipeRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [serverOrchestrationStateMachine.stateMachineArn],
      }),
    );

    new Pipe(this, "DynamoToSfnPipe", {
      role: pipeRole,
      filter: new Filter([
        FilterPattern.fromObject({
          eventName: ["INSERT"],
        }),
      ]),
      source: new DynamoDBSource(props.provisioningHistoryTable, {
        startingPosition: DynamoDBStartingPosition.LATEST,
      }),
      target: new SfnStateMachine(serverOrchestrationStateMachine, {
        invocationType: StateMachineInvocationType.FIRE_AND_FORGET,
        inputTransformation: InputTransformation.fromObject({
          serverId: DynamicInput.fromEventPath(
            "$.dynamodb.NewImage.serverId.S",
          ),
          startedAt: DynamicInput.fromEventPath(
            "$.dynamodb.NewImage.startedAt.N",
          ),
          serverConfig: {
            version: DynamicInput.fromEventPath(
              "$.dynamodb.NewImage.serverConfig.M.version.S",
            ),
            type: DynamicInput.fromEventPath(
              "$.dynamodb.NewImage.serverConfig.M.type.S",
            ),
          },
        }),
      }),
    });

    const instanceTerminatorHandler = new NodejsFunction(
      this,
      "InstanceTerminatorHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/instance_terminator_handler/index.ts",
          import.meta.url,
        ).pathname,
        environment: { TABLE_NAME: props.provisioningHistoryTable.tableName },
        bundling: {
          minify: true,
          nodeModules: ["zod"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    instanceTerminatorHandler.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "ecs:DescribeContainerInstances",
          "ec2:TerminateInstances",
          "ecs:DescribeTasks",
        ],
        resources: ["*"],
      }),
    );
    instanceTerminatorHandler.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:UpdateItem"],
        resources: [props.provisioningHistoryTable.tableArn],
      }),
    );

    new Rule(this, "EcsTaskStoppedRule", {
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: {
          clusterArn: [computeConstruct.cluster.clusterArn],
          lastStatus: ["STOPPED"],
          group: ["minecraft-on-demand"],
        },
      },
      targets: [new LambdaFunction(instanceTerminatorHandler)],
    });
  }
}
