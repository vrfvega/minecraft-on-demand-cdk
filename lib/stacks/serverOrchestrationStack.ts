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
  SfnStateMachine as SfnStateMachineAlpha,
  StateMachineInvocationType,
} from "@aws-cdk/aws-pipes-targets-alpha";
import { Stack, type StackProps } from "aws-cdk-lib";
import type { ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import type { ISecurityGroup, IVpc } from "aws-cdk-lib/aws-ec2";
import { Rule } from "aws-cdk-lib/aws-events";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { ComputeConstruct } from "../constructs/ComputeConstruct.js";
import { ServerProvisioningOrchestratorConstruct } from "../constructs/ServerProvisioningOrchestratorConstruct.js";
import { ServerTeardownOrchestratorConstruct } from "../constructs/ServerTeardownOrchestratorConstruct.js";

export interface ServerOrchestrationStackProps extends StackProps {
  vpc: IVpc;
  securityGroup: ISecurityGroup;
  serverHistoryTable: ITableV2;
  minecraftWorldsBucket: IBucket;
}

export class ServerOrchestrationStack extends Stack {
  readonly computeConstruct: ComputeConstruct;

  constructor(
    scope: Construct,
    id: string,
    props: ServerOrchestrationStackProps,
  ) {
    super(scope, id, props);

    this.computeConstruct = new ComputeConstruct(this, "Compute", {
      vpc: props.vpc,
      minecraftWorldsBucket: props.minecraftWorldsBucket,
    });

    const serverProvisioningOrchestrator =
      new ServerProvisioningOrchestratorConstruct(
        this,
        "ServerProvisioningOrchestrator",
        {
          vpc: props.vpc,
          securityGroup: props.securityGroup,
          serverHistoryTable: props.serverHistoryTable,
          minecraftWorldsBucket: props.minecraftWorldsBucket,
          computeConstruct: this.computeConstruct,
        },
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
        resources: [props.serverHistoryTable.tableArn],
      }),
    );
    pipeRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [
          serverProvisioningOrchestrator.stateMachine.stateMachineArn,
        ],
      }),
    );

    new Pipe(this, "DynamoToSfnPipe", {
      role: pipeRole,
      filter: new Filter([
        FilterPattern.fromObject({
          eventName: ["INSERT"],
        }),
      ]),
      source: new DynamoDBSource(props.serverHistoryTable, {
        startingPosition: DynamoDBStartingPosition.LATEST,
      }),
      target: new SfnStateMachineAlpha(
        serverProvisioningOrchestrator.stateMachine,
        {
          invocationType: StateMachineInvocationType.FIRE_AND_FORGET,
          inputTransformation: InputTransformation.fromObject({
            serverId: DynamicInput.fromEventPath(
              "$.dynamodb.NewImage.serverId.S",
            ),
            startedAt: DynamicInput.fromEventPath(
              "$.dynamodb.NewImage.startedAt.N",
            ),
            userId: DynamicInput.fromEventPath("$.dynamodb.NewImage.userId.S"),
            serverConfig: {
              version: DynamicInput.fromEventPath(
                "$.dynamodb.NewImage.serverConfig.M.version.S",
              ),
              type: DynamicInput.fromEventPath(
                "$.dynamodb.NewImage.serverConfig.M.type.S",
              ),
            },
          }),
        },
      ),
    });

    const serverTeardownOrchestrator = new ServerTeardownOrchestratorConstruct(
      this,
      "ServerTeardownOrchestrator",
      {
        serverHistoryTable: props.serverHistoryTable,
        minecraftWorldsBucket: props.minecraftWorldsBucket,
      },
    );

    new Rule(this, "EcsTaskStoppedRule", {
      eventPattern: {
        source: ["aws.ecs"],
        detailType: ["ECS Task State Change"],
        detail: {
          clusterArn: [this.computeConstruct.cluster.clusterArn],
          lastStatus: ["STOPPED"],
          group: ["minecraft-on-demand"],
        },
      },
      targets: [new SfnStateMachine(serverTeardownOrchestrator.stateMachine)],
    });
  }
}
