import { RemovalPolicy, type StackProps } from "aws-cdk-lib";
import {
  type ISecurityGroup,
  type IVpc,
  Peer,
  Port,
  SecurityGroup,
} from "aws-cdk-lib/aws-ec2";
import {
  AccessPoint,
  FileSystem,
  type IAccessPoint,
  type IFileSystem,
  ThroughputMode,
} from "aws-cdk-lib/aws-efs";
import { Construct } from "constructs";

export interface EfsConstructProps extends StackProps {
  vpc: IVpc;
}

export class EfsConstruct extends Construct {
  readonly filesystem: IFileSystem;
  readonly defaultAccessPoint: IAccessPoint;

  private readonly securityGroup: ISecurityGroup;

  constructor(scope: Construct, id: string, props: EfsConstructProps) {
    super(scope, id);
    this.securityGroup = new SecurityGroup(this, "EfsSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: "Default security group for EFS",
    });
    this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.NFS);

    this.filesystem = new FileSystem(this, "MinecraftWorldsFileSystem", {
      vpc: props.vpc,
      securityGroup: this.securityGroup,
      fileSystemName: "MinecraftWorldsFileSystem",
      removalPolicy: RemovalPolicy.DESTROY,
      encrypted: true,
      throughputMode: ThroughputMode.ELASTIC,
    });

    this.defaultAccessPoint = new AccessPoint(this, "DefaultAccessPoint", {
      fileSystem: this.filesystem,
      path: "/",
      posixUser: {
        uid: "1000",
        gid: "1000",
      },
      createAcl: {
        ownerUid: "1000",
        ownerGid: "1000",
        permissions: "0755",
      },
    });
  }
}
