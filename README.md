# EverActive
Capstone CSC 400

# Project Structure

```
EverActive/
├── backend/            # Express API
│   ├── src/
│   │   ├── app.js      # Express app and routes (imported by tests)
│   │   └── server.js   # Starts the server
│   ├── tests/          # Jest + Supertest tests
│   ├── Dockerfile
│   └── .env.example    # Template for environment variables
├── mobile/             # React Native app (coming soon)
└── docker-compose.yml  # Runs backend + MySQL togethe
