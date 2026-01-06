import { useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  signInWithEmail, 
  signUpWithEmail, 
  resetPasswordForEmail,
  updatePassword,
  signOut
} from "@/services/auth/auth-service";
import type { 
  LoginInput, 
  SignUpInput, 
  ForgotPasswordInput, 
  UpdatePasswordInput 
} from "@/lib/validations/auth";

export const useSignIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: LoginInput) => signInWithEmail(credentials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
    },
  });
};

export const useSignUp = () => {
  return useMutation({
    mutationFn: (credentials: SignUpInput) => signUpWithEmail(credentials),
  });
};

export const useResetPassword = () => {
  return useMutation({
    mutationFn: ({ email, redirectTo }: { email: string; redirectTo?: string }) => 
      resetPasswordForEmail({ email }, redirectTo),
  });
};

export const useUpdatePassword = () => {
  return useMutation({
    mutationFn: (data: UpdatePasswordInput) => updatePassword(data),
  });
};

export const useSignOut = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
    },
  });
};
