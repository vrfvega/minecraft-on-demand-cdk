import { aws_logs, type StackProps } from "aws-cdk-lib";
import {
  type ISecurityGroup,
  type IVpc,
  Peer,
  Port,
  SecurityGroup,
  UserData,
} from "aws-cdk-lib/aws-ec2";
import {
  AwsLogDriver,
  Cluster,
  type ContainerDefinition,
  ContainerImage,
  Ec2TaskDefinition,
  NetworkMode,
  Protocol,
} from "aws-cdk-lib/aws-ecs";
import {
  InstanceProfile,
  ManagedPolicy,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export interface EcsConstructProps extends StackProps {
  vpc: IVpc;
}

export class ComputeConstruct extends Construct {
  public readonly cluster: Cluster;
  public readonly taskDefinition: Ec2TaskDefinition;
  public readonly containerDefinition: ContainerDefinition;
  public readonly ecsOptimizedAmiArm64: string;
  public readonly userData: UserData;
  public readonly instanceRole: Role;
  public readonly instanceProfile: InstanceProfile;

  private readonly securityGroup: ISecurityGroup;

  constructor(scope: Construct, id: string, props: EcsConstructProps) {
    super(scope, id);
    const { vpc } = props;

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Default SG for Minecraft servers",
    });
    this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.allTraffic());

    this.cluster = new Cluster(this, "Cluster", { vpc });

    this.taskDefinition = new Ec2TaskDefinition(this, "Ec2TaskDefinition", {
      networkMode: NetworkMode.BRIDGE,
    });

    this.containerDefinition = this.taskDefinition.addContainer(
      "MinecraftJavaServer",
      {
        image: ContainerImage.fromRegistry("itzg/minecraft-server"),
        cpu: 2048,
        memoryReservationMiB: 1024,
        environment: {
          EULA: "TRUE",
          ENABLE_QUERY: "true",
          MOTD: "A §nPZ§r server. Powered by §6AWS§r",
          OPS: "Viktor1778",
          ENABLE_AUTOSTOP: "TRUE",
          AUTOSTOP_TIMEOUT_INIT: "300",
          AUTOSTOP_TIMEOUT_EST: "300",
          NETWORK_COMPRESSION_THRESHOLD: "256",
          VIEW_DISTANCE: "8",
          SIMULATION_DISTANCE: "4",
          USE_AIKAR_FLAGS: "true",
          SYNC_CHUNK_WRITES: "FALSE",
        },
        logging: new AwsLogDriver({
          logRetention: aws_logs.RetentionDays.ONE_DAY,
          streamPrefix: "MinecraftJavaServer",
        }),
      },
    );
    this.containerDefinition.addPortMappings(
      { containerPort: 25565, hostPort: 25565, protocol: Protocol.TCP },
      { containerPort: 25565, hostPort: 25565, protocol: Protocol.UDP },
    );

    this.ecsOptimizedAmiArm64 = StringParameter.valueForStringParameter(
      this,
      "/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id",
    );

    this.userData = UserData.forLinux();
    this.userData.addCommands(
      `echo ECS_CLUSTER=${this.cluster.clusterName} >> /etc/ecs/ecs.config`,
      "mkdir -p /var/log/ecs",
    );

    this.instanceRole = new Role(this, "EC2InstanceRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2FullAccess"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonEC2ContainerServiceforEC2Role",
        ),
      ],
    });

    this.instanceProfile = new InstanceProfile(this, "EC2InstanceProfile", {
      role: this.instanceRole,
    });
  }
}
