import { getServiceClient } from "@repo/database";

async function main() {
  const supabase = getServiceClient();
  const { data: exec } = await supabase
    .from("scout_executions")
    .select("*")
    .eq("id", "1b0047db-a598-4b26-a716-a0d5a5d7c75c")
    .single();

  const { data: steps } = await supabase
    .from("scout_execution_steps")
    .select("*")
    .eq("execution_id", "1b0047db-a598-4b26-a716-a0d5a5d7c75c")
    .order("step_number", { ascending: true });

  console.log("EXECUTION:", JSON.stringify(exec, null, 2));
  console.log("STEPS:", JSON.stringify(steps, null, 2));
}

main().catch(console.error);
