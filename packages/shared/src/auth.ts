import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Email inválido");

/** 10 caracteres em vez de 8: é uma conta só, exposta na internet, e você digita raramente. */
export const passwordSchema = z
  .string()
  .min(10, "A senha precisa de no mínimo 10 caracteres")
  .max(200, "Senha longa demais");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, "Informe seu nome").max(120),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe a senha"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/** O refresh token não trafega no corpo — vive num cookie httpOnly. */
export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
}
