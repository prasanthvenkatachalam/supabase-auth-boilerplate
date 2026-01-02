import { useMutation } from "@tanstack/react-query";
import { signInWithEmail, signUpWithEmail, type AuthCredentials } from "@/services/auth/auth-service";

export const useSignIn = () => {
  return useMutation({
    mutationFn: (credentials: AuthCredentials) => 
      signInWithEmail(credentials),
  });
};

export const useSignUp = () => {
  return useMutation({
    mutationFn: (credentials: AuthCredentials) => 
      signUpWithEmail(credentials),
  });
};
