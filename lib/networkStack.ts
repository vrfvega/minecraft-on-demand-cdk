import {Stack, type StackProps} from "aws-cdk-lib";
import {type ISecurityGroup, type IVpc, Peer, Port, SecurityGroup, SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import type {Construct} from "constructs";

export class NetworkStack extends Stack {
  public readonly vpc: IVpc;
  public readonly securityGroup: ISecurityGroup;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, "VPC", {
      maxAzs: 1,
      natGateways: 0,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {name: "PrivateIsolated", subnetType: SubnetType.PRIVATE_ISOLATED},
        {name: "Public", subnetType: SubnetType.PUBLIC},
      ],
    });

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: this.vpc,
      description: "Default security group for Minecraft server tasks",
      allowAllOutbound: true
    })

    this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.allTraffic());
  }
}
