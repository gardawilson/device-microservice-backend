# Device Service

A production-ready Node.js microservice for managing devices, built with Express.js and MongoDB (Mongoose).

## Features

- Printer tracking module with usage logging, status checking, and reset management
- Clean architecture with separated concerns (routes, controllers, services, models)
- Swagger API documentation
- Docker support for easy deployment
- Environment-based configuration

## Project Structure

```
device-service/
├── src/
│   ├── routes/
│   │   └── printerRoutes.js
│   ├── controllers/
│   │   └── printerController.js
│   ├── services/
│   │   └── printerService.js
│   ├── models/
│   │   ├── Device.js
│   │   ├── DeviceLog.js
│   │   └── DeviceMaintenance.js
│   ├── middlewares/
│   │   └── errorMiddleware.js
│   ├── configs/
│   │   └── database.js
│   └── utils/
├── app.js
├── server.js
├── package.json
├── .env
├── Dockerfile
└── README.md
```

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables in `.env`:
   ```
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/device-service
   NODE_ENV=development
   ```
4. Start MongoDB (if running locally)
5. Run the service:
   ```bash
   npm start
   ```

For development with auto-restart:

```bash
npm run dev
```

## API Endpoints

### Printer Management

#### Create Printer

- **POST** `/api/devices/printers`
- **Body:**
  ```json
  {
    "mac": "AA:BB:CC:DD:EE:FF",
    "name": "Zebra Printer 1"
  }
  ```

#### Get All Printers

- **GET** `/api/devices/printers`
- **Response:**
  ```json
  {
    "printers": [
      {
        "id": "60d5ecb74b24c72b8c8b4567",
        "identifier": "AA:BB:CC:DD:EE:FF",
        "totalPrint": 1500,
        "lastMaintenancePrint": 1000,
        "lastUsedAt": "2023-10-01T12:00:00.000Z",
        "currentFactory": "Factory A",
        "status": "WARNING"
      }
    ]
  }
  ```

#### Log Printer Usage

- **POST** `/api/devices/printers/log`
- **Body:**
  ```json
  {
    "identifier": "AA:BB:CC:DD:EE:FF",
    "totalLabel": 100,
    "sourceApp": "PrintApp",
    "factory": "Factory A"
  }
  ```

#### Move Printer

- **POST** `/api/devices/printers/move`
- **Body:**
  ```json
  {
    "printerId": "AA:BB:CC:DD:EE:FF",
    "toFactory": "Factory B",
    "movedBy": "John Doe"
  }
  ```

#### Get Printer Status

- **GET** `/api/devices/printers/status?printerId=AA:BB:CC:DD:EE:FF`
- **Response:**
  ```json
  {
    "printerId": "AA:BB:CC:DD:EE:FF",
    "totalPrint": 1500,
    "printsSinceMaintenance": 500,
    "status": "WARNING",
    "lastUsedAt": "2023-10-01T12:00:00.000Z"
  }
  ```

#### Reset Printer Counter

- **POST** `/api/devices/printers/reset`
- **Body:**
  ```json
  {
    "identifier": "AA:BB:CC:DD:EE:FF"
  }
  ```

#### Update Printer Name

- **PATCH** `/api/devices/printers/:id`
- **Body:**
  ```json
  {
    "name": "Zebra Printer 2"
  }
  ```

#### Delete Printer

- **DELETE** `/api/devices/printers/:id`

## API Usage Examples

### Using curl

Create a new printer:

```bash
curl -X POST http://localhost:3000/api/devices/printers \
  -H "Content-Type: application/json" \
  -d '{
    "mac": "AA:BB:CC:DD:EE:FF",
    "name": "Zebra Printer 1"
  }'
```

Get all printers:

```bash
curl http://localhost:3000/api/devices/printers
```

Log printer usage:

```bash
curl -X POST http://localhost:3000/api/devices/printers/log \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "AA:BB:CC:DD:EE:FF",
    "totalLabel": 100,
    "sourceApp": "PrintApp",
    "factory": "Factory A"
  }'
```

Move printer:

```bash
curl -X POST http://localhost:3000/api/devices/printers/move \
  -H "Content-Type: application/json" \
  -d '{
    "printerId": "AA:BB:CC:DD:EE:FF",
    "toFactory": "Factory B",
    "movedBy": "John Doe"
  }'
```

Get printer status:

```bash
curl "http://localhost:3000/api/devices/printers/status?printerId=AA:BB:CC:DD:EE:FF"
```

Reset printer counter:

```bash
curl -X POST http://localhost:3000/api/devices/printers/reset \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "AA:BB:CC:DD:EE:FF"
  }'
```

## Swagger Documentation

Access the API documentation at: `http://localhost:3000/api-docs`

## Docker Deployment

Build the Docker image:

```bash
docker build -t device-service .
```

Run the container:

```bash
docker run -p 3000:3000 --env-file .env device-service
```

## Business Logic

- **Status Calculation:**
  - NORMAL: prints since maintenance < 1000
  - WARNING: prints since maintenance >= 1000
  - CRITICAL: prints since maintenance >= 2000

- **Reset:** Resets the `lastMaintenancePrint` counter to the current `totalPrint` value

## Environment Variables

- `PORT`: Server port (default: 3000)
- `MONGODB_URI`: MongoDB connection string
- `NODE_ENV`: Environment (development/production)
