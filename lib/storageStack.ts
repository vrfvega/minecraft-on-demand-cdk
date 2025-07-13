import {RemovalPolicy, Stack, type StackProps} from "aws-cdk-lib";
import {AttributeType, Billing, type ITableV2, StreamViewType, TableV2} from "aws-cdk-lib/aws-dynamodb";
import type {Construct} from "constructs";

export class StorageStack extends Stack {
  public readonly provisioningHistoryTable: ITableV2;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.provisioningHistoryTable = new TableV2(this, "ProvisioningHistory", {
      tableName: "ProvisioningHistory",
      partitionKey: { name: "executionId", type: AttributeType.STRING },
      sortKey: { name: "timestamp", type: AttributeType.NUMBER },
      billing: Billing.onDemand(),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      dynamoStream: StreamViewType.NEW_IMAGE
    });
  }
}
