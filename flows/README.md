# Saved flows

JavaScript files. Each one exports a default async function that receives the
flow context.

Every tool call inside a flow uses the same authorization/audit path as a direct
call. Default authorization belongs to the host/model; optional explicit policy
can add local restrictions.

Known desktop steps collect in one prepared batch until a dependency: observation,
sleep, explicit flush or successful completion. A failed flow cancels pending
actions. Single flushed actions execute immediately; multiple actions get the
configured batch notice (five seconds by default). No model turn occurs while
native input is held. Inspect progress after failures rather than replaying.

**The JavaScript itself is not sandboxed.** A flow is your own code running in
the server process, exactly like a script you would run yourself. Anyone who
can write a file into this directory can run code as you.

Point `COMPUTER_CUSTOM_FLOWS` somewhere else to use a different directory.
