"use client";
import useEnsureAuth from "@/app/hooks/useEnsureAuth";
import { Slot } from "expo-router";

export default function ProtectedLayout() {
  const { loading } = useEnsureAuth(true); // <-- blocks unauthenticated users

  if (loading) {
    // Minimal splash while Firebase resolves the session
    return null; // or return a tiny loading view
  }
  return <Slot />;
}
