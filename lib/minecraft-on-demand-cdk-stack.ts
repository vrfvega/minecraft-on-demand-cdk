import * as cdk from "aws-cdk-lib";
import {
  aws_apigatewayv2,
  aws_lambda,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "node:path";
import { PAYLOAD_VALIDATOR_LAMBDA_NODE_MODULES } from "./constants";

export class MinecraftOnDemandCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
  }

  serverPayloadValidationLambda = new NodejsFunction(
    this,
    "server_payload_validation",
    {
      runtime: aws_lambda.Runtime.NODEJS_22_X,
      architecture: aws_lambda.Architecture.ARM_64,
      memorySize: 1024,
      entry: path.join(
        __dirname,
        "../lambda/server_payload_validation/index.ts",
      ),
      bundling: {
        minify: true,
        nodeModules: PAYLOAD_VALIDATOR_LAMBDA_NODE_MODULES,
      },
    },
  );

  const api = new aws_apigatewayv2.HttpApi(this, "PayloadValidator", {
    apiName: "PayloadValidatorApi",
    createDefaultStage: true,
  });

  api.addRoutes({
    path: '/webhooks/memberships',
    methods: [aws_apigatewayv2.HttpMethod.POST],
    integration: new HttpLambdaIntegration("MembershipWebhookIntegration", webhookReceiverLambda)
  })
}
