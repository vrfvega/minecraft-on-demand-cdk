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
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export interface ComputeConstructProps extends StackProps {
  vpc: IVpc;
  minecraftWorldsBucket: IBucket;
}

export class ComputeConstruct extends Construct {
  readonly cluster: Cluster;
  readonly taskDefinition: Ec2TaskDefinition;
  readonly containerDefinition: ContainerDefinition;
  readonly ecsOptimizedAmiArm64: string;
  readonly userData: UserData;
  readonly instanceRole: Role;
  readonly instanceProfile: InstanceProfile;

  private readonly securityGroup: ISecurityGroup;

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: "Default SG for Minecraft servers",
    });
    this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.allTraffic());

    this.cluster = new Cluster(this, "Cluster", { vpc: props.vpc });

    this.taskDefinition = new Ec2TaskDefinition(this, "Ec2TaskDefinition", {
      networkMode: NetworkMode.BRIDGE,
    });
    this.taskDefinition.addVolume({
      name: "MinecraftData",
      host: {
        sourcePath: "/minecraft_data",
      },
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
    this.containerDefinition.addMountPoints({
      containerPath: "/data",
      sourceVolume: "MinecraftData",
      readOnly: false,
    });

    this.ecsOptimizedAmiArm64 = StringParameter.valueForStringParameter(
      this,
      "/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id",
    );

    this.userData = UserData.forLinux();
    this.userData.addCommands(`
      set -e
      sudo systemctl mask ecs
      mkdir -p /var/log/ecs /var/log/minecraft /minecraft_data
      export LOG_FILE=/var/log/minecraft/server.log
      touch $LOG_FILE
      exec > >(tee -a $LOG_FILE) 2>&1
      export TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
      export USER_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/tags/instance/userId)
      aws s3 sync s3://${props.minecraftWorldsBucket.bucketName}/$USER_ID /minecraft_data --only-show-errors --no-progress
      echo ECS_CLUSTER=${this.cluster.clusterName} >> /etc/ecs/ecs.config
      sudo systemctl unmask ecs
      sudo systemctl enable --now --no-block ecs
    `);

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

    props.minecraftWorldsBucket.grantReadWrite(this.instanceRole);
    props.minecraftWorldsBucket.grantReadWrite(this.instanceRole);
  }
}
