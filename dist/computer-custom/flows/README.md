# Saved flows

JavaScript files. Each one exports a default async function that receives the
flow context.

Every tool call inside a flow goes through the same policy gate as a direct
call, so a flow can still be blocked or stop to ask you.

**The JavaScript itself is not sandboxed.** A flow is your own code running in
the server process, exactly like a script you would run yourself. Anyone who
can write a file into this directory can run code as you.

Point `COMPUTER_CUSTOM_FLOWS` somewhere else to use a different directory.
