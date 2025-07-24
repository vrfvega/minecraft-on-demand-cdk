import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  AttributeType,
  Billing,
  type ITableV2,
  StreamViewType,
  TableV2,
} from "aws-cdk-lib/aws-dynamodb";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  type IBucket,
} from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { USER_ID_INDEX_NAME } from "../constants.js";

export class StorageStack extends Stack {
  readonly serverHistoryTable: ITableV2;
  readonly minecraftWorldsBucket: IBucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.serverHistoryTable = new TableV2(this, "ServerHistory", {
      tableName: "ServerHistory",
      partitionKey: { name: "serverId", type: AttributeType.STRING },
      sortKey: { name: "startedAt", type: AttributeType.NUMBER },
      billing: Billing.onDemand(),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      dynamoStream: StreamViewType.NEW_IMAGE,
      globalSecondaryIndexes: [
        {
          indexName: USER_ID_INDEX_NAME,
          partitionKey: { name: "userId", type: AttributeType.STRING },
          sortKey: { name: "startedAt", type: AttributeType.NUMBER },
        },
      ],
    });

    const minecraftWorldsAccessLogsBucket = new Bucket(
      this,
      "MinecraftWorldsAccessLogs",
      {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        encryption: BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        publicReadAccess: false,
        removalPolicy: RemovalPolicy.RETAIN,
      },
    );

    this.minecraftWorldsBucket = new Bucket(this, "MinecraftWorlds", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.RETAIN,
      serverAccessLogsBucket: minecraftWorldsAccessLogsBucket,
    });
  }
}
