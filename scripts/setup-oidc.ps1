# Run this ONCE to set up GitHub OIDC trust with AWS
# Requires: aws-cli configured with admin credentials

$ErrorActionPreference = "Stop"

$GITHUB_ORG = "Dangutman98"
$GITHUB_REPO = "botanical-agent"
$AWS_ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text)
$REGION = "us-east-1"

Write-Host "Setting up GitHub OIDC for $GITHUB_ORG/$GITHUB_REPO → AWS Account $AWS_ACCOUNT_ID"

# 1. Create OIDC provider for GitHub (skip if exists)
$EXISTING = aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?contains(Arn, 'github-actions')].Arn" --output text

if ([string]::IsNullOrWhiteSpace($EXISTING)) {
  $PROVIDER_ARN = aws iam create-open-id-connect-provider `
    --url https://token.actions.githubusercontent.com `
    --client-id-list sts.amazonaws.com `
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" `
    --query OpenIDConnectProviderArn --output text
  Write-Host "Created OIDC provider: $PROVIDER_ARN"
} else {
  $PROVIDER_ARN = $EXISTING
  Write-Host "OIDC provider already exists: $PROVIDER_ARN"
}

# 2. Create trust policy
$SUB_VALUE = "repo:${GITHUB_ORG}/${GITHUB_REPO}:*"
$TRUST_POLICY = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "$PROVIDER_ARN"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "$SUB_VALUE"
        }
      }
    }
  ]
}
"@

$TRUST_POLICY | Out-File -FilePath "$env:TEMP\trust-policy.json" -Encoding UTF8

# 3. Create IAM role
$ROLE_NAME = "GitHubActionsDeployRole"
aws iam create-role `
  --role-name $ROLE_NAME `
  --assume-role-policy-document file://"$env:TEMP\trust-policy.json" 2>$null

# 4. Attach policies
$POLICIES = @(
  "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess",
  "arn:aws:iam::aws:policy/AWSLambda_FullAccess",
  "arn:aws:iam::aws:policy/IAMFullAccess",
  "arn:aws:iam::aws:policy/CloudWatchFullAccess",
  "arn:aws:iam::aws:policy/AmazonS3FullAccess"
)

foreach ($POLICY in $POLICIES) {
  aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn $POLICY
}

# 5. Create S3 bucket for Terraform state
$STATE_BUCKET = "botanical-agent-terraform-state-$AWS_ACCOUNT_ID"
$EXISTING_BUCKET = aws s3api head-bucket --bucket $STATE_BUCKET 2>$null
if ($LASTEXITCODE -ne 0) {
  aws s3 mb s3://$STATE_BUCKET --region $REGION
  aws s3api put-bucket-versioning --bucket $STATE_BUCKET --versioning-configuration Status=Enabled
  Write-Host "Created S3 state bucket: s3://$STATE_BUCKET"
} else {
  Write-Host "S3 state bucket already exists: s3://$STATE_BUCKET"
}

Write-Host ""
Write-Host "Setup complete!"
Write-Host "Add these secrets to your GitHub repo:"
Write-Host "  AWS_ACCOUNT_ID = $AWS_ACCOUNT_ID"
Write-Host "  GROQ_API_KEY = <your-key>"
Write-Host ""
Write-Host "Then push to main to trigger deployment"
