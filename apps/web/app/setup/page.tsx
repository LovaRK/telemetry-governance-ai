'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<'tenant' | 'admin' | 'complete'>('tenant');
  const [tenantData, setTenantData] = useState({
    name: '',
    slug: '',
  });
  const [adminData, setAdminData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdTenant, setCreatedTenant] = useState<{ id: string; slug: string } | null>(null);

  const handleTenantChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTenantData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAdminChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setAdminData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/setup/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tenantData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to create tenant');
        setLoading(false);
        return;
      }

      const tenant = await response.json();
      setCreatedTenant(tenant);
      setStep('admin');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (adminData.password !== adminData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (adminData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/setup/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: createdTenant?.id,
          email: adminData.email,
          password: adminData.password,
          name: adminData.name,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to create admin');
        setLoading(false);
        return;
      }

      setStep('complete');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoToLogin = () => {
    router.push(`/login?tenant=${createdTenant?.slug}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">
              Teja Governance Dashboard
            </h1>
            <p className="text-slate-600">Initial Setup</p>
          </div>

          {/* Progress Indicator */}
          <div className="flex justify-between mb-8">
            <div className={`flex-1 h-2 rounded ${step === 'tenant' || step === 'admin' || step === 'complete' ? 'bg-blue-600' : 'bg-slate-200'}`}></div>
            <div className={`flex-1 h-2 rounded ml-2 ${step === 'admin' || step === 'complete' ? 'bg-blue-600' : 'bg-slate-200'}`}></div>
            <div className={`flex-1 h-2 rounded ml-2 ${step === 'complete' ? 'bg-blue-600' : 'bg-slate-200'}`}></div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Step 1: Create Tenant */}
          {step === 'tenant' && (
            <form onSubmit={handleCreateTenant} className="space-y-4">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">Create Organization</h2>

              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                  Organization Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  name="name"
                  placeholder="e.g., Acme Corp"
                  value={tenantData.name}
                  onChange={handleTenantChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label htmlFor="slug" className="block text-sm font-medium text-slate-700 mb-1">
                  Organization Slug <span className="text-red-500">*</span>
                </label>
                <input
                  id="slug"
                  type="text"
                  name="slug"
                  placeholder="e.g., acme-corp"
                  value={tenantData.slug}
                  onChange={handleTenantChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  URL-safe identifier (lowercase, hyphens only)
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium py-2 px-4 rounded-lg transition duration-200"
              >
                {loading ? 'Creating...' : 'Continue'}
              </button>
            </form>
          )}

          {/* Step 2: Create Admin User */}
          {step === 'admin' && (
            <form onSubmit={handleCreateAdmin} className="space-y-4">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">Create Admin Account</h2>

              <p className="text-sm text-slate-600 mb-4">
                Organization: <strong>{createdTenant?.slug}</strong>
              </p>

              <div>
                <label htmlFor="admin_name" className="block text-sm font-medium text-slate-700 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="admin_name"
                  type="text"
                  name="name"
                  placeholder="John Doe"
                  value={adminData.name}
                  onChange={handleAdminChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label htmlFor="admin_email" className="block text-sm font-medium text-slate-700 mb-1">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  id="admin_email"
                  type="email"
                  name="email"
                  placeholder="admin@example.com"
                  value={adminData.email}
                  onChange={handleAdminChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label htmlFor="admin_password" className="block text-sm font-medium text-slate-700 mb-1">
                  Password <span className="text-red-500">*</span>
                </label>
                <input
                  id="admin_password"
                  type="password"
                  name="password"
                  placeholder="••••••••"
                  value={adminData.password}
                  onChange={handleAdminChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label htmlFor="admin_confirm_password" className="block text-sm font-medium text-slate-700 mb-1">
                  Confirm Password <span className="text-red-500">*</span>
                </label>
                <input
                  id="admin_confirm_password"
                  type="password"
                  name="confirmPassword"
                  placeholder="••••••••"
                  value={adminData.confirmPassword}
                  onChange={handleAdminChange}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium py-2 px-4 rounded-lg transition duration-200"
              >
                {loading ? 'Creating Admin...' : 'Complete Setup'}
              </button>
            </form>
          )}

          {/* Step 3: Complete */}
          {step === 'complete' && (
            <div className="text-center">
              <div className="mb-4 text-4xl">✓</div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Setup Complete!</h2>
              <p className="text-slate-600 mb-6">
                Your organization is ready. Sign in with your admin account to get started.
              </p>
              <button
                onClick={handleGoToLogin}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition duration-200"
              >
                Go to Login
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-slate-200 text-center">
            <p className="text-sm text-slate-600">
              Already have an account?{' '}
              <Link href="/login" className="text-blue-600 hover:underline">
                Sign in here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
