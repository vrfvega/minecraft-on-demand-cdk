import path from "node:path";
import {DynamicInput, Filter, FilterPattern, InputTransformation, Pipe} from "@aws-cdk/aws-pipes-alpha";
import {DynamoDBSource, DynamoDBStartingPosition} from "@aws-cdk/aws-pipes-sources-alpha";
import {SfnStateMachine, StateMachineInvocationType} from "@aws-cdk/aws-pipes-targets-alpha";
import {aws_logs, Duration, Stack, type StackProps} from "aws-cdk-lib";
import type {ITableV2} from "aws-cdk-lib/aws-dynamodb";
import {type ISecurityGroup, type IVpc, UserData} from "aws-cdk-lib/aws-ec2";
import {AwsLogDriver, Cluster, ContainerImage, Ec2TaskDefinition, NetworkMode, Protocol} from "aws-cdk-lib/aws-ecs";
import {InstanceProfile, ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {Architecture, Runtime} from "aws-cdk-lib/aws-lambda";
import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {
  Choice,
  Condition,
  DefinitionBody,
  IntegrationPattern,
  JsonPath, Pass,
  StateMachine,
  TaskInput,
  Wait,
  WaitTime
} from "aws-cdk-lib/aws-stepfunctions";
import {CallAwsService, LambdaInvoke} from "aws-cdk-lib/aws-stepfunctions-tasks";
import type {Construct} from "constructs";

export interface ServerOrchestrationStackProps extends StackProps {
  vpc: IVpc;
  securityGroup: ISecurityGroup;
  provisioningHistoryTable: ITableV2;
}

export class ServerOrchestrationStack extends Stack {
  constructor(scope: Construct, id: string, props: ServerOrchestrationStackProps) {
    super(scope, id, props);
    const cluster = new Cluster(this, "Cluster", { vpc: props.vpc });

    const taskDefinition = new Ec2TaskDefinition(this, "Ec2TaskDefinition", {
      networkMode: NetworkMode.BRIDGE
    });

    const containerDefinition = taskDefinition.addContainer("MinecraftJavaServer", {
      image: ContainerImage.fromRegistry("itzg/minecraft-server"),
      cpu: 2048,
      memoryReservationMiB: 1024,
      environment: {
        "EULA": "TRUE",
        "ENABLE_QUERY": "true",
        "MOTD": "A §nPZ§r server. Powered by §6AWS§r",
        "OPS": "Viktor1778",
        "ENABLE_AUTOSTOP": "TRUE",
        "AUTOSTOP_TIMEOUT_INIT": "600",
        "AUTOSTOP_TIMEOUT_EST": "600",
        "NETWORK_COMPRESSION_THRESHOLD": "256",
        "VIEW_DISTANCE": "8",
        "SIMULATION_DISTANCE": "4",
        "USE_AIKAR_FLAGS": "true",
        "SYNC_CHUNK_WRITES": "FALSE",
      },
      logging: new AwsLogDriver({
        logRetention: aws_logs.RetentionDays.ONE_DAY, streamPrefix: "MinecraftJavaServer"
      })
    });

    containerDefinition.addPortMappings(
      {containerPort: 25565, hostPort: 25565, protocol: Protocol.TCP},
      {containerPort: 25565, hostPort: 25565, protocol: Protocol.UDP},
    );

    const userData = UserData.forLinux();
    userData.addCommands(
      `echo ECS_CLUSTER=${cluster.clusterName} >> /etc/ecs/ecs.config`,
      'sudo mkdir -p /var/log/ecs',
    )

    const ecsOptimizedAmiArm64 = StringParameter.valueForStringParameter(
      this,
      "/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id"
    );

    const ec2InstanceRole = new Role(this, "EC2InstanceRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2FullAccess"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2ContainerServiceforEC2Role"),
      ]
    });

    const ec2InstanceProfile = new InstanceProfile(this, 'EC2InstanceProfile', {
      role: ec2InstanceRole,
    });

    const unwrapInput = new Pass(this, "UnwrapInput", {
      inputPath: "$[0]",
      resultPath: "$"
    })

    const runInstance = new CallAwsService(this, "Run EC2 instance", {
      service: "ec2",
      action: "runInstances",
      iamResources: ["*"],
      parameters: {
        "ImageId": ecsOptimizedAmiArm64,
        "InstanceType": "t4g.small",
        "MinCount": 1,
        "MaxCount": 1,
        "SubnetId": props.vpc.publicSubnets.at(0)!.subnetId,
        "SecurityGroupIds": [props.securityGroup.securityGroupId],
        "IamInstanceProfile": {
          "Name": ec2InstanceProfile.instanceProfileName
        },
        "UserData": JsonPath.base64Encode(userData.render()),
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultPath: "$.runInstanceResult"
    });

    const instanceCheckerHandler = new NodejsFunction(
      this,
      "InstanceCheckerHandler",
      {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        entry: path.join(
          __dirname,
          "../lambdas/instance_checker_handler/index.ts",
        ),
        bundling: {
          minify: true,
          nodeModules: ["zod"],
          externalModules: ['@aws-sdk/*'],
        },
      },
    );

    instanceCheckerHandler.addToRolePolicy(new PolicyStatement({
      actions: ["ecs:ListContainerInstances", "ecs:DescribeContainerInstances"],
      resources: ["*"]
    }))

    const waitInLoop = new Wait(this,"Wait between polls", {
      time: WaitTime.duration(Duration.seconds(15)),
    });

    const checkInstanceReadiness = new LambdaInvoke(this, "Check instance readiness", {
      lambdaFunction: instanceCheckerHandler,
      payloadResponseOnly: true,
      payload: TaskInput.fromObject({
        "clusterName": cluster.clusterName,
        "ec2InstanceId": JsonPath.stringAt('$.runInstanceResult.Instances[0].InstanceId')
      }),
      resultPath: "$.checkerResult"
    });

    const runServerTask = new CallAwsService(this, "Run server task", {
      service: "ecs",
      action: "runTask",
      iamResources: ["*"],
      parameters: {
        "Cluster": cluster.clusterName,
        "TaskDefinition": taskDefinition.taskDefinitionArn,
        "LaunchType": "EC2",
        "PlacementConstraints":[{
          "Type": "memberOf",
          "Expression": JsonPath.format(
            'ec2InstanceId == {}',
            JsonPath.stringAt('$.runInstanceResult.Instances[0].InstanceId')
          )
        }],
        "Overrides": {
          "ContainerOverrides": [{
            "Name": containerDefinition.containerName,
            "Environment": [
              {"Name": "TYPE", "Value": JsonPath.stringAt("$.serverConfig.type")},
              {"Name": "VERSION", "Value": JsonPath.stringAt("$.serverConfig.version")},
            ]
          }]
        }
      },
      integrationPattern: IntegrationPattern.REQUEST_RESPONSE,
      resultPath: "$.runServerTaskResult",
    });

    const serverOrchestrationStateMachine = new StateMachine(this, "ServerOrchestrator", {
      definitionBody: DefinitionBody.fromChainable(
        unwrapInput
          .next(runInstance)
          .next(waitInLoop)
          .next(checkInstanceReadiness)
          .next(new Choice(this, "Is instance ready?")
            .when(Condition.booleanEquals('$.checkerResult.instanceIsReady', true), runServerTask)
            .otherwise(waitInLoop)
          )
      )
    });

    serverOrchestrationStateMachine.role.addToPrincipalPolicy(new PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [
        ec2InstanceRole.roleArn,
        taskDefinition.executionRole!.roleArn,
        taskDefinition.taskRole.roleArn
      ],
    }));

    const pipeRole = new Role(this, "PipeRole", {
      assumedBy: new ServicePrincipal("pipes.amazonaws.com")
    });

    pipeRole.addToPrincipalPolicy(new PolicyStatement({
      actions: ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:ListStreams"],
      resources: [props.provisioningHistoryTable.tableArn]
    }));

    pipeRole.addToPrincipalPolicy(new PolicyStatement({
      actions: ["states:StartExecution"],
      resources: [serverOrchestrationStateMachine.stateMachineArn]
    }));

    new Pipe(this, "DynamoToSfnPipe", {
      role: pipeRole,
      filter: new Filter([
        FilterPattern.fromObject({
          eventName: ["INSERT"]
        })
      ]),
      source: new DynamoDBSource(props.provisioningHistoryTable, {
        startingPosition: DynamoDBStartingPosition.LATEST,
      }),
      target: new SfnStateMachine(serverOrchestrationStateMachine, {
        invocationType: StateMachineInvocationType.FIRE_AND_FORGET,
        inputTransformation: InputTransformation.fromObject({
          "serverConfig": {
            "version": DynamicInput.fromEventPath("$.dynamodb.NewImage.serverConfig.M.version.S"),
            "type": DynamicInput.fromEventPath("$.dynamodb.NewImage.serverConfig.M.type.S")
          }
        })
      })
    });
  }
}
