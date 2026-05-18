import { NextRequest, NextResponse } from 'next/server';

// Inline startup validation (runs once per server instance)
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateStartupConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const llmModel = process.env.LLM_MODEL;
  if (llmModel) {
    const supported = ['gemma2:9b', 'gemma:2b', 'gemma4:e4b', 'mistral', 'llama2'];
    if (!supported.includes(llmModel)) {
      warnings.push(`LLM_MODEL="${llmModel}" is not in the standard list. Proceeding.`);
    }
    if (llmModel === 'gemma4:e4b') {
      warnings.push('LLM_MODEL=gemma4:e4b requires 32GB+ GPU. If you have only 16GB, switch to "gemma2:9b".');
    }
  } else {
    warnings.push(
      'LLM_MODEL is not set. Running in DEMO_MODE without LLM inference. ' +
      'Set to "gemma2:9b" for full-stack mode.'
    );
  }

  if (!process.env.DATABASE_URL) {
    warnings.push('DATABASE_URL is not set. Running in DEMO_MODE without database access. Set it for full-stack mode.');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    warnings.push('ANTHROPIC_API_KEY is not set. Fallback to Anthropic will be unavailable.');
  }

  // No hard errors for web-only mode — let APIs handle DEMO_MODE gracefully
  return { valid: true, errors, warnings };
}

function logValidation(result: ValidationResult): void {
  const tag = '[StartupValidation]';
  if (result.errors.length > 0) {
    console.error(`${tag} FATAL configuration errors:`);
    result.errors.forEach((err) => console.error(`  ❌ ${err}`));
  }
  if (result.warnings.length > 0) {
    console.warn(`${tag} Configuration warnings:`);
    result.warnings.forEach((warn) => console.warn(`  ⚠ ${warn}`));
  }
  if (result.valid) {
    console.log(`${tag} ✓ Configuration valid. LLM_MODEL=${process.env.LLM_MODEL || '(default)'}`);
  }
}

let validationRun = false;

export function middleware(request: NextRequest) {
  if (!validationRun) {
    validationRun = true;
    const result = validateStartupConfig();
    logValidation(result);

    if (!result.valid) {
      return NextResponse.json(
        {
          error: 'Service startup failed',
          details: 'Critical configuration errors. Check logs.',
          errors: result.errors,
        },
        { status: 503 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
