variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "groq_api_key" {
  description = "Groq API key for the botanical assistant"
  type        = string
  sensitive   = true
  default     = "managed-manually"
}

variable "jina_api_key" {
  description = "Jina AI API key for web search"
  type        = string
  sensitive   = true
  default     = "managed-manually"
}
