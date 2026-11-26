export async function runLogged<Result>(run: () => Promise<Result>): Promise<Result> {
  console.log("start");
  try {
    return await run();
  } finally {
    console.log("end");
  }
}
