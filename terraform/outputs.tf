output "lambda_url" {
  description = "Lambda Function URL endpoint"
  value       = aws_lambda_function_url.app.function_url
}

output "ecr_repository" {
  description = "ECR repository URI"
  value       = aws_ecr_repository.app.repository_url
}
