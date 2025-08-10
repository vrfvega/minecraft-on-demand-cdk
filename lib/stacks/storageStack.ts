import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AttributeType,
  Billing,
  type ITableV2,
  StreamViewType,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import type { IVpc } from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";
import { USER_ID_INDEX_NAME } from "../constants.js";
import { EfsConstruct } from "../constructs/efsConstruct.js";

export interface StorageStackProps extends StackProps {
  vpc: IVpc;
}

export class StorageStack extends Stack {
  readonly serverHistoryTable: ITableV2;
  readonly serverConfigurationTable: ITableV2;
  readonly modpackTable: ITableV2;
  readonly efsConstruct: EfsConstruct;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    this.serverHistoryTable = new TableV2(this, "ServerHistory", {
      tableName: "ServerHistory",
      partitionKey: { name: "serverId", type: AttributeType.STRING },
      sortKey: { name: "startedAt", type: AttributeType.NUMBER },
      billing: Billing.onDemand(),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      dynamoStream: StreamViewType.NEW_IMAGE,
      globalSecondaryIndexes: [
        {
          indexName: USER_ID_INDEX_NAME,
          partitionKey: { name: "userId", type: AttributeType.STRING },
          sortKey: { name: "startedAt", type: AttributeType.NUMBER },
        },
      ],
    });

    this.serverConfigurationTable = new TableV2(this, "ServerConfiguration", {
      tableName: "ServerConfiguration",
      partitionKey: { name: "userId", type: AttributeType.STRING },
      billing: Billing.onDemand(),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.modpackTable = new TableV2(this, "Modpacks", {
      tableName: "Modpacks",
      partitionKey: { name: "modpackId", type: AttributeType.STRING },
      sortKey: { name: "createdAt", type: AttributeType.NUMBER },
      billing: Billing.onDemand(),
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      globalSecondaryIndexes: [
        {
          indexName: USER_ID_INDEX_NAME,
          partitionKey: { name: "userId", type: AttributeType.STRING },
          sortKey: { name: "createdAt", type: AttributeType.NUMBER },
        },
      ],
    });

    this.efsConstruct = new EfsConstruct(this, "SharedEfs", {
      vpc: props.vpc,
    });
  }
}
