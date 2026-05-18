'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

interface UserContextType {
  userId: string | null;
  userName: string;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState('Human Reviewer');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Try to get user from localStorage
    const savedUser = localStorage.getItem('datasensai_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUserId(parsed.id || null);
        setUserName(parsed.name || 'Human Reviewer');
      } catch {
        // Invalid format, use defaults
      }
    }
    setIsLoading(false);
  }, []);

  return (
    <UserContext.Provider value={{ userId, userName, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within UserProvider');
  }
  return context;
}
