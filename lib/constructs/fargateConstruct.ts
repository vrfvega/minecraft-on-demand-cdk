import { Stack, type StackProps } from "aws-cdk-lib";
import {
  type ISecurityGroup,
  type IVpc,
  Peer,
  Port,
  SecurityGroup,
} from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerInsights } from "aws-cdk-lib/aws-ecs";
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface FargateConstructProps extends StackProps {
  vpc: IVpc;
}

export class FargateConstruct extends Construct {
  readonly cluster: Cluster;
  readonly taskRole: Role;
  readonly taskExecutionRole: Role;

  private readonly securityGroup: ISecurityGroup;

  constructor(scope: Construct, id: string, props: FargateConstructProps) {
    super(scope, id);
    this.taskRole = new Role(this, "EcsTaskRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Minecraft ECS Task Role",
    });

    this.taskExecutionRole = new Role(this, "EcsTaskExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Minecraft ECS Task Execution Role",
    });

    // Allow pulling images from ECR and writing logs to CloudWatch Logs
    this.taskExecutionRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy",
      ),
    );
    // Also allow creating log groups when using awslogs driver with auto-create
    this.taskExecutionRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [
          `arn:aws:logs:${Stack.of(this).region}:${Stack.of(this).account}:log-group:/aws/ecs/*`,
        ],
      }),
    );

    this.securityGroup = new SecurityGroup(this, "FargateSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: "Default security group for Minecraft servers (ECS Fargate)",
    });
    this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.allTraffic());

    this.cluster = new Cluster(this, "FargateCluster", {
      vpc: props.vpc,
      clusterName: "FargateCluster",
      containerInsightsV2: ContainerInsights.ENHANCED,
    });
  }
}
