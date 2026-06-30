# SmartApp UI Kit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **ALPHA NOTICE:**  
> This project is in ALPHA. It is under active development and may change at any time.  
> Breaking changes, new features, and bug fixes will be added frequently as I build out real apps using this template.  
> Feedback and contributions are welcome!

**SmartApp UI Kit** is a reusable AI-first **React + TypeScript + Tailwind CSS** dashboard template with Framer Motion animations.

> **All new application code must be TypeScript.** Do not add new `.js` or `.jsx` source files unless explicitly approved.

## 🚀 Features
- Modern dashboard layout…
- ✅ Responsive: Works great on desktop and mobile devices

## 🛠️ Built With

- [VS Code](https://code.visualstudio.com/)
- [Cursor](https://www.cursor.so/)
- [ChatGPT (OpenAI)](https://chat.openai.com/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Cypress](https://www.cypress.io/)
- [Jest](https://jestjs.io/)

---

## 🙏 Credits & Inspiration

- This project's design was inspired by [jobhire.ai](https://jobhire.ai).

---

## 🏁 Getting Started

Follow these steps to set up the project locally:

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd <your-repo-folder>
   ```

2. **Install all dependencies (including testing tools):**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   The app will be available at [http://localhost:5173](http://localhost:5173) by default.

4. **Run TypeScript checks:**
   ```bash
   npm run typecheck
   ```

5. **Run unit tests:**
   ```bash
   npm test
   ```

6. **Run E2E tests (with dev server running):**
   ```bash
   npm run cypress:open
   # or
   npm run cypress:run
   ```

---

## 🚀 Using This Template to Build Your Own App

To use this project as a starting point for your own application:

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url> my-new-app
   cd my-new-app
   ```

2. **Remove the existing git history (optional, but recommended):**
   ```bash
   rm -rf .git
   git init
   git add .
   git commit -m "Initial commit from SmartApp UI Kit template"
   ```

3. **Update the project metadata:**
   - Edit `package.json` to change the `name`, `description`, and other fields.
   - Update the `README.md` to reflect your new project's purpose.

4. **Install dependencies:**
   ```bash
   npm install
   ```

5. **Start building your app:**
   - Run the dev server:
     ```bash
     npm run dev
     ```
   - Begin customizing components, pages, and styles to fit your needs.

6. **(Optional) Remove or update example tests and E2E flows as you build your own features.**

**Tip:**
You can keep the testing setup and structure as a foundation for your own app's tests!

---

## 🧪 Testing

### Unit & Integration Tests

- **Framework:** Jest + React Testing Library
- **Location:** Test files are placed next to their implementation files (e.g., `MyComponent.tsx` and `MyComponent.test.tsx`).
- **Coverage:** The suite covers components, store logic, and API clients.

**To run all unit tests with coverage:**
```bash
npm test
```
or
```bash
npm run test
```
- A coverage summary will be shown in the terminal.
- Detailed HTML coverage reports are generated in the `coverage/` directory.

---

### End-to-End (E2E) Tests

- **Framework:** Cypress
- **Location:** E2E tests are in `cypress/e2e/`.
- **What's covered:** Key user flows, navigation, and responsive layout.

**To run E2E tests interactively:**
```bash
npm run cypress:open
```
- This opens the Cypress UI for running and debugging tests.

**To run E2E tests headlessly:**
```bash
npm run cypress:run
```

**Before running E2E tests, make sure your dev server is running:**
```bash
npm run dev
```
> **Note:** You must keep the app running in a separate terminal window while running Cypress tests (including headless mode). Cypress does not start the app server for you.

---

### Notes

- Some E2E tests are skipped if the corresponding feature is not yet implemented.
- Unit tests are colocated with source files for easy maintenance.
- Cypress baseUrl is set to `http://localhost:5173` (update in `cypress.config.js` if needed).

## Contributing

We welcome contributions! To help maintain code quality and reliability, please follow these rules:

- **Tests Required:** All new features and bug fixes must include appropriate unit and/or E2E tests.
- **Code Coverage:** Code coverage must not decrease. If possible, aim to increase coverage with your changes.
- **Run Tests:** Run `npm test -- --coverage` and `npx cypress run` before submitting a pull request.
- **Passing Checks:** All tests must pass locally and in CI before your PR will be reviewed or merged.

If you have questions or need help with testing, feel free to open an issue or ask in your pull request!
