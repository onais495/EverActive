import { useState } from 'react';

import type { Activity, Category } from '@/data/activities';
import { ACTIVITIES } from '@/data/activities';
import DetailScreen from '@/screens/DetailScreen';
import LoadingScreen from '@/screens/LoadingScreen';
import LoginScreen from '@/screens/LoginScreen';
import OnboardingScreen from '@/screens/OnboardingScreen';
import PlanScreen from '@/screens/PlanScreen';
import RegisterScreen from '@/screens/RegisterScreen';

type Stage = 'login' | 'register' | 'onboarding' | 'loading' | 'plan';

export default function HomeScreen() {
  const [stage, setStage] = useState<Stage>('login');
  const [chosen, setChosen] = useState<string[]>([]);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [filter, setFilter] = useState<'All' | Category>('All');

  const toggleInterest = (interest: string) => {
    setChosen((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
    );
  };

  const buildWeek = () => {
    setRemoved([]);
    setFilter('All');
    setStage('loading');
    setTimeout(() => setStage('plan'), 1500);
  };

  const removeActivity = (id: string) => {
    setRemoved((prev) => [...prev, id]);
  };

  const plan =
    chosen.length === 0
      ? ACTIVITIES.slice(0, 4)
      : ACTIVITIES.map((a) => ({
          activity: a,
          score: a.interests.filter((i) => chosen.includes(i)).length,
        }))
          .filter((s) => s.score > 0)
          .sort((x, y) => y.score - x.score)
          .map((s) => s.activity)
          .slice(0, 5);

  const activePlan = plan.filter((a) => !removed.includes(a.id));

  if (stage === 'login') {
    return (
      <LoginScreen
        onLogin={() => setStage('onboarding')}
        onGoRegister={() => setStage('register')}
      />
    );
  }

  if (stage === 'register') {
    return (
      <RegisterScreen
        onRegister={() => setStage('onboarding')}
        onGoLogin={() => setStage('login')}
      />
    );
  }

  if (stage === 'onboarding') {
    return <OnboardingScreen chosen={chosen} onToggle={toggleInterest} onBuild={buildWeek} />;
  }

  if (stage === 'loading') {
    return <LoadingScreen />;
  }

  if (selected) {
    return (
      <DetailScreen
        activity={selected}
        onBack={() => setSelected(null)}
        onRemove={() => {
          removeActivity(selected.id);
          setSelected(null);
        }}
      />
    );
  }

  return (
    <PlanScreen
      plan={activePlan}
      chosen={chosen}
      filter={filter}
      onFilter={setFilter}
      onOpen={setSelected}
      onRemove={removeActivity}
      onEditInterests={() => setStage('onboarding')}
    />
  );
}