# Cloud Backend

This folder contains the AWS SAM backend for the cloud migration.

## What it creates

- A private S3 asset bucket. Browser uploads use short-lived presigned URLs.
- API Gateway REST API protected by a Cognito user pool.
- One API Lambda for assets, MongoDB-backed state, AI analysis, outfit recommendation, job creation, and job status.
- One worker Lambda that reads source images from S3, calls the selected AI provider, stores the result in S3, and updates job status in MongoDB.

## Secure configuration

Create these two SSM Parameter Store `SecureString` parameters before deployment. Each Lambda reads the two exact parameters on cold start and caches them for the life of that execution environment. The values never enter CloudFormation, Lambda environment variables, deployment commands, or this repository. This avoids Secrets Manager's per-secret monthly charge.

`/cloth-try-on/dev/mongodb-uri`:

```text
mongodb+srv://...
```

`/cloth-try-on/dev/ai-provider-json`:

```json
{
  "GEMINI_API_KEY":"...",
  "OPENAI_API_KEY":"..."
}
```

## Deploy

Install the AWS SAM CLI, configure AWS credentials for the target account, then run from this directory:

```powershell
npm install
sam build
sam deploy --guided --region ap-southeast-2
```

The default SSM parameter names above are used unless you override them at deployment. New Lambda execution environments read the latest parameter value automatically after rotation. Set `AllowedOrigin` to the final frontend origin before deploying a public site.

The API is intentionally protected by Cognito. The Next.js frontend will receive the API URL and Cognito IDs in the next migration step.

To use an existing AWS SSO profile first refresh its token:

```powershell
aws sso login
```

## MongoDB Atlas networking

The functions in this first version are not placed in a VPC, which avoids paying for a NAT gateway. Atlas therefore needs a reachable public endpoint. For a personal M0 cluster this commonly means allowing `0.0.0.0/0` in the Atlas IP access list while using a dedicated least-privilege database user and the TLS connection string in SSM Parameter Store.

For a stricter production setup, use Atlas PrivateLink or place Lambda in a VPC behind a NAT gateway with a fixed Elastic IP, then allow only that address in Atlas.
