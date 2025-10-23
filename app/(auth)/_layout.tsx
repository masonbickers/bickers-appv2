"use client";
import useEnsureAuth from "@/app/hooks/useEnsureAuth";
import { Slot, useRouter } from "expo-router";
import { useEffect } from "react";

export default function AuthLayout() {
  const { user, loading } = useEnsureAuth(false);
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      // Already signed in → send to your app home
      router.replace("/(protected)");
    }
  }, [user, loading]);

  if (loading) return null;
  return <Slot />;
}
