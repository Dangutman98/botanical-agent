terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket = "botanical-agent-terraform-state"
    key    = "terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  name        = "botanical-agent"
  environment = var.environment
  tags = {
    Name        = local.name
    Environment = local.environment
  }
}

data "aws_caller_identity" "current" {}

# ECR Repository
resource "aws_ecr_repository" "app" {
  name                 = "${local.name}-${local.environment}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only last 5 images"
      selection = {
        tagStatus     = "any"
        countType     = "imageCountMoreThan"
        countNumber   = 5
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# IAM Role for Lambda
resource "aws_iam_role" "lambda" {
  name = "${local.name}-lambda-${local.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Lambda Function
resource "aws_lambda_function" "app" {
  function_name = "${local.name}-${local.environment}"
  role          = aws_iam_role.lambda.arn
  timeout       = 30
  memory_size   = 512
  package_type  = "Image"
  architectures = ["x86_64"]

  image_uri    = "${aws_ecr_repository.app.repository_url}:latest"

  environment {
    variables = {
      NODE_ENV     = "production"
      PORT         = "3000"
      GROQ_API_KEY = var.groq_api_key
    }
  }

  tags = local.tags

  depends_on = [aws_ecr_repository.app]
}

# Lambda URL (built-in, free, no API Gateway needed)
resource "aws_lambda_function_url" "app" {
  function_name      = aws_lambda_function.app.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["*"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 3600
  }
}

resource "aws_lambda_permission" "url" {
  statement_id  = "AllowFunctionURLInvoke"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.app.function_name
  principal     = "*"
  function_url_auth_type = aws_lambda_function_url.app.authorization_type
}
