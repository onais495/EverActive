export type Category = 'Solo' | 'Social' | 'Intellectual';

export type Activity = {
  id: string;
  title: string;
  category: Category;
  interests: string[];
  day: string;
  time: string;
  location: string;
  attendees: number;
  description: string;
};

export const ACTIVITIES: Activity[] = [
  {
    id: '1',
    title: 'Small-group Broadway discussion',
    category: 'Social',
    interests: ['Broadway'],
    day: 'Thursday',
    time: '7:00 PM',
    location: 'Midtown, Manhattan',
    attendees: 12,
    description: "A relaxed evening talking through the season's best shows with a small group.",
  },
  {
    id: '2',
    title: 'Morning walk through the Botanical Garden',
    category: 'Solo',
    interests: ['Gardens'],
    day: 'Saturday',
    time: '9:30 AM',
    location: 'New York Botanical Garden',
    attendees: 0,
    description: 'A quiet self-guided walk through the seasonal gardens.',
  },
  {
    id: '3',
    title: 'Markets and investing talk',
    category: 'Intellectual',
    interests: ['Markets'],
    day: 'Tuesday',
    time: '5:00 PM',
    location: 'Public Library, Bryant Park',
    attendees: 20,
    description: 'An open discussion on current market trends led by a local analyst.',
  },
  {
    id: '4',
    title: 'Alumni networking brunch',
    category: 'Social',
    interests: ['Alumni events'],
    day: 'Sunday',
    time: '11:00 AM',
    location: 'Upper West Side',
    attendees: 15,
    description: 'Casual brunch with fellow alumni from your university.',
  },
  {
    id: '5',
    title: 'Guided tour at the Met',
    category: 'Intellectual',
    interests: ['Museums'],
    day: 'Saturday',
    time: '1:00 PM',
    location: 'The Metropolitan Museum of Art',
    attendees: 10,
    description: 'A docent-led walk through the highlights of the European galleries.',
  },
  {
    id: '6',
    title: 'Neighborhood book club',
    category: 'Social',
    interests: ['Book clubs'],
    day: 'Wednesday',
    time: '6:30 PM',
    location: 'Brooklyn Public Library',
    attendees: 9,
    description: "This month's pick is a new historical novel. Newcomers welcome.",
  },
  {
    id: '7',
    title: 'Jazz night in the Village',
    category: 'Social',
    interests: ['Live music'],
    day: 'Friday',
    time: '8:00 PM',
    location: 'Greenwich Village',
    attendees: 30,
    description: 'Live trio in an intimate club, with a table reserved for the group.',
  },
  {
    id: '8',
    title: 'Knicks watch party',
    category: 'Social',
    interests: ['Sports'],
    day: 'Monday',
    time: '7:30 PM',
    location: 'Midtown sports bar',
    attendees: 25,
    description: 'Catch the game with other fans at a reserved section.',
  },
];

export const INTERESTS = [
  'Broadway',
  'Gardens',
  'Markets',
  'Museums',
  'Sports',
  'Book clubs',
  'Alumni events',
  'Live music',
];

export const FILTERS: ('All' | Category)[] = ['All', 'Solo', 'Social', 'Intellectual'];