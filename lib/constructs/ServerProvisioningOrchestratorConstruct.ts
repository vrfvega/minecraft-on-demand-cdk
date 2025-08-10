import { Duration, type StackProps } from "aws-cdk-lib";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import type { ISecurityGroup, IVpc } from "aws-cdk-lib/aws-ec2";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
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
import { Construct } from "constructs";
import type { EfsConstruct } from "./efsConstruct.js";
import type { FargateConstruct } from "./fargateConstruct.js";

export interface ServerProvisioningOrchestratorProps extends StackProps {
  vpc: IVpc;
  securityGroup: ISecurityGroup;
  serverHistoryTable: ITableV2;
  efsConstruct: EfsConstruct;
  fargateConstruct: FargateConstruct;
}

export class ServerProvisioningOrchestratorConstruct extends Construct {
  readonly definition: IChainable;
  readonly stateMachine: StateMachine;

  constructor(
    scope: Construct,
    id: string,
    props: ServerProvisioningOrchestratorProps,
  ) {
    super(scope, id);

    const unwrapInput = new Pass(this, "UnwrapInput", {
      inputPath: "$[0]",
      resultPath: "$",
    });

    const createAccessPoint = new CallAwsService(
      this,
      "Create EFS access point",
      {
        service: "efs",
        action: "createAccessPoint",
        iamResources: [props.efsConstruct.filesystem.fileSystemArn],
        parameters: {
          FileSystemId: props.efsConstruct.filesystem.fileSystemId,
          ClientToken: JsonPath.uuid(),
          PosixUser: {
            Uid: 1000,
            Gid: 1000,
          },
          RootDirectory: {
            Path: JsonPath.format("/{}", JsonPath.stringAt("$.userId")),
            CreationInfo: {
              OwnerUid: 1000,
              OwnerGid: 1000,
              Permissions: "0755",
            },
          },
        },
        integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
        resultSelector: {
          "ClientToken.$": "$.ClientToken",
          "AccessPointArn.$": "$.AccessPointArn",
          "AccessPointId.$": "$.AccessPointId",
        },
        resultPath: "$.efsAccessPoint",
      },
    );

    const registerTaskDefinition = new CallAwsService(
      this,
      "Register task definition",
      {
        service: "ecs",
        action: "registerTaskDefinition",
        iamResources: ["*"],
        parameters: {
          Family: JsonPath.format("user_{}", JsonPath.stringAt("$.userId")),
          RequiresCompatibilities: ["FARGATE"],
          NetworkMode: "awsvpc",
          Cpu: "1024",
          Memory: "2048",
          RuntimePlatform: {
            CpuArchitecture: "ARM64",
            OperatingSystemFamily: "LINUX",
          },
          TaskRoleArn: props.fargateConstruct.taskRole.roleArn,
          ExecutionRoleArn: props.fargateConstruct.taskExecutionRole.roleArn,
          Volumes: [
            {
              Name: "data",
              EfsVolumeConfiguration: {
                FileSystemId: props.efsConstruct.filesystem.fileSystemId,
                TransitEncryption: "ENABLED",
                AuthorizationConfig: {
                  AccessPointId: JsonPath.stringAt(
                    "$.efsAccessPoint.AccessPointId",
                  ),
                  Iam: "ENABLED",
                },
              },
            },
          ],
          ContainerDefinitions: [
            {
              Name: "java-minecraft-server",
              Image: "itzg/minecraft-server",
              Essential: true,
              LogConfiguration: {
                LogDriver: "awslogs",
                Options: {
                  "awslogs-create-group": "true",
                  "awslogs-group": JsonPath.format(
                    "/aws/ecs/user_{}",
                    JsonPath.stringAt("$.userId"),
                  ),
                  "awslogs-region": "us-east-1", //TODO: Make this dynamic
                  "awslogs-stream-prefix": JsonPath.stringAt("$.serverId"),
                },
              },
              Environment: [
                { Name: "EULA", Value: "TRUE" },
                { Name: "ENABLE_QUERY", Value: "true" },
                { Name: "MEMORY", Value: "1G" },
                { Name: "MOTD", Value: "A §nPZ§r server. Powered by §6AWS§r" },
                { Name: "OPS", Value: "Viktor1778" },
                { Name: "ENABLE_AUTOSTOP", Value: "TRUE" },
                { Name: "AUTOSTOP_TIMEOUT_INIT", Value: "300" },
                { Name: "AUTOSTOP_TIMEOUT_EST", Value: "300" },
                { Name: "USE_AIKAR_FLAGS", Value: "false" },
                { Name: "USE_MEOWICE_FLAGS", Value: "true" },
                {
                  Name: "TYPE",
                  Value: JsonPath.stringAt("$.serverConfig.type"),
                },
                {
                  Name: "VERSION",
                  Value: JsonPath.stringAt("$.serverConfig.version"),
                },
                {
                  Name: "ALLOW_FLIGHT",
                  Value: JsonPath.stringAt("$.serverConfig.allow_flight"),
                },
                {
                  Name: "ALLOW_NETHER",
                  Value: JsonPath.stringAt("$.serverConfig.allow_nether"),
                },
                {
                  Name: "DIFFICULTY",
                  Value: JsonPath.stringAt("$.serverConfig.difficulty"),
                },
                {
                  Name: "GENERATE_STRUCTURES",
                  Value: JsonPath.stringAt(
                    "$.serverConfig.generate_structures",
                  ),
                },
                {
                  Name: "HARDCORE",
                  Value: JsonPath.stringAt("$.serverConfig.hardcore"),
                },
                {
                  Name: "LEVEL_TYPE",
                  Value: JsonPath.stringAt("$.serverConfig.level_type"),
                },
                {
                  Name: "MAX_PLAYERS",
                  Value: JsonPath.stringAt("$.serverConfig.max_players"),
                },
                {
                  Name: "MODE",
                  Value: JsonPath.stringAt("$.serverConfig.mode"),
                },
                {
                  Name: "NETWORK_COMPRESSION_THRESHOLD",
                  Value: JsonPath.stringAt(
                    "$.serverConfig.network_compression_threshold",
                  ),
                },
                {
                  Name: "ONLINE_MODE",
                  Value: JsonPath.stringAt("$.serverConfig.online_mode"),
                },
                {
                  Name: "SEED",
                  Value: JsonPath.stringAt("$.serverConfig.seed"),
                },
                {
                  Name: "SIMULATION_DISTANCE",
                  Value: JsonPath.stringAt(
                    "$.serverConfig.simulation_distance",
                  ),
                },
                {
                  Name: "SPAWN_ANIMALS",
                  Value: JsonPath.stringAt("$.serverConfig.spawn_animals"),
                },
                {
                  Name: "SPAWN_MONSTERS",
                  Value: JsonPath.stringAt("$.serverConfig.spawn_monsters"),
                },
                {
                  Name: "SPAWN_NPCS",
                  Value: JsonPath.stringAt("$.serverConfig.spawn_npcs"),
                },
                {
                  Name: "SPAWN_PROTECTION",
                  Value: JsonPath.stringAt("$.serverConfig.spawn_protection"),
                },
                {
                  Name: "SYNC_CHUNK_WRITES",
                  Value: JsonPath.stringAt("$.serverConfig.sync_chunk_writes"),
                },
                {
                  Name: "VIEW_DISTANCE",
                  Value: JsonPath.stringAt("$.serverConfig.view_distance"),
                },
              ],
              MountPoints: [
                {
                  SourceVolume: "data",
                  ContainerPath: "/data",
                  ReadOnly: false,
                },
              ],
              PortMappings: [
                { ContainerPort: 25565, Protocol: "tcp" },
                { ContainerPort: 25565, Protocol: "udp" },
              ],
            },
          ],
        },
        integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
        resultSelector: {
          "TaskDefinitionArn.$": "$.TaskDefinition.TaskDefinitionArn",
        },
        resultPath: "$.registeredTaskDefinition",
      },
    );

    const runServerTask = new CallAwsService(this, "Run server task", {
      service: "ecs",
      action: "runTask",
      iamResources: ["*"],
      parameters: {
        Cluster: props.fargateConstruct.cluster.clusterName,
        TaskDefinition: JsonPath.stringAt(
          "$.registeredTaskDefinition.TaskDefinitionArn",
        ),
        LaunchType: "FARGATE",
        Group: "minecraft-on-demand",
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            AssignPublicIp: "ENABLED",
            SecurityGroups: [props.securityGroup.securityGroupId],
            Subnets: [props.vpc.publicSubnets.at(0)!.subnetId],
          },
        },
        Tags: [
          { Key: "serverId", Value: JsonPath.stringAt("$.serverId") },
          { Key: "startedAt", Value: JsonPath.numberAt("$.startedAt") },
          {
            Key: "taskDefinitionArn",
            Value: JsonPath.stringAt(
              "$.registeredTaskDefinition.TaskDefinitionArn",
            ),
          },
          {
            Key: "accessPointId",
            Value: JsonPath.stringAt("$.efsAccessPoint.AccessPointId"),
          },
        ],
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultPath: "$.runServerTaskResult",
    });

    const instanceReadinessValidator = new NodejsFunction(
      this,
      "InstanceReadinessValidatorHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.minutes(1),
        entry: new URL(
          "../../lambdas/instanceReadinessValidatorHandler.ts",
          import.meta.url,
        ).pathname,
        bundling: {
          minify: true,
          nodeModules: ["zod"],
          externalModules: ["@aws-sdk/*"],
        },
      },
    );
    instanceReadinessValidator.addToRolePolicy(
      new PolicyStatement({
        actions: ["ecs:DescribeTasks", "ec2:DescribeNetworkInterfaces"],
        resources: ["*"],
      }),
    );
    const getServerStatus = new LambdaInvoke(this, "Get server status", {
      lambdaFunction: instanceReadinessValidator,
      payloadResponseOnly: true,
      payload: TaskInput.fromObject({
        clusterName: props.fargateConstruct.cluster.clusterName,
        taskArn: JsonPath.stringAt("$.runServerTaskResult.Tasks[0].TaskArn"),
      }),
      resultPath: "$.checkerResult",
    });

    const waitForServer = new Wait(this, "Wait for server", {
      time: WaitTime.duration(Duration.seconds(10)),
    });

    const serverProvisioningFailed = new Fail(
      this,
      "Server provisioning failed",
      {
        cause: "Server provisioning failed",
        error: "Server did not become ready in the alloted time.",
      },
    );

    const updateDdbItem = new DynamoUpdateItem(this, "Update DDB item", {
      table: props.serverHistoryTable,
      key: {
        serverId: DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.serverId"),
        ),
        startedAt: DynamoAttributeValue.fromNumber(
          JsonPath.numberAt("$.startedAt"),
        ),
      },
      updateExpression: "SET serverStatus = :ss, publicIp = :ip, taskArn = :ta",
      expressionAttributeValues: {
        ":ss": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.runServerTaskResult.Tasks[0].DesiredStatus"),
        ),
        ":ip": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.checkerResult.publicIp"),
        ),
        ":ta": DynamoAttributeValue.fromString(
          JsonPath.stringAt("$.runServerTaskResult.Tasks[0].TaskArn"),
        ),
      },
      resultPath: JsonPath.DISCARD,
    });

    const isServerReady = new Choice(this, "Is server ready?")
      .when(
        Condition.booleanEquals("$.checkerResult.isServerReady", true),
        updateDdbItem,
      )
      .when(
        Condition.booleanEquals("$.checkerResult.isServerReady", false),
        waitForServer,
      )
      .otherwise(serverProvisioningFailed);

    this.definition = unwrapInput
      .next(createAccessPoint)
      .next(registerTaskDefinition)
      .next(runServerTask)
      .next(waitForServer)
      .next(getServerStatus)
      .next(isServerReady);

    this.stateMachine = new StateMachine(this, `${id}-StateMachine`, {
      stateMachineName: `${id}`,
      definitionBody: DefinitionBody.fromChainable(this.definition),
      stateMachineType: StateMachineType.STANDARD,
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
          "ecs:TagResource",
          "ec2:CreateTags",
          "elasticfilesystem:CreateAccessPoint",
          "ecs:RegisterTaskDefinition",
          "ecs:RunTask",
          "ecs:DescribeTasks",
          "ec2:DescribeNetworkInterfaces",
        ],
        resources: ["*"],
      }),
    );
    this.stateMachine.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [
          props.fargateConstruct.taskRole.roleArn,
          props.fargateConstruct.taskExecutionRole.roleArn,
        ],
      }),
    );
    props.serverHistoryTable.grantWriteData(this.stateMachine);
  }
}
