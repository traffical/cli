/**
 * Shared types for the multi-language code generation system.
 */

export type CodegenLanguage = "typescript";

export interface CodegenOptions {
  language: CodegenLanguage;
  /** Include JSDoc/doc comments from schema descriptions */
  includeDescriptions?: boolean;
}

export interface CodegenResult {
  /** Generated source code as a string */
  content: string;
  /** File extension for the output (e.g., ".ts", ".go") */
  extension: string;
  /** Language that was generated */
  language: CodegenLanguage;
}
