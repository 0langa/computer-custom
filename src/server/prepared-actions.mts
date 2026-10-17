import { z } from "zod";

export const targetSchema=z.object({handle:z.number().int().positive(),pid:z.number().int().positive(),processStartTime:z.string().nullable()});
const point={x:z.number().int().nonnegative(),y:z.number().int().nonnegative()};
const button=z.enum(["left","right","middle"]).optional();
const expectSchema=z.object({elementId:z.string().min(1),property:z.enum(["value","name","focused","enabled"]),equals:z.union([z.string(),z.boolean()]),timeoutMs:z.number().int().positive().max(2000).optional()}).strict();
const selectorSchema=z.object({name:z.string().min(1).optional(),automationId:z.string().min(1).optional(),role:z.string().min(1).optional()})
  .strict().refine(v=>!!(v.name||v.automationId),"Selector needs an exact name or automationId");
const action=<T extends string>(op:T,args:z.ZodTypeAny)=>z.object({op:z.literal(op),target:targetSchema,args,expect:expectSchema.optional()});
export const preparedActionSchema=z.discriminatedUnion("op",[
  action("focus_window",z.object({}).strict()),
  action("wait_for",z.object({name:z.string().min(1).optional(),automationId:z.string().min(1).optional(),role:z.string().min(1).optional(),
    timeoutMs:z.number().int().positive().max(10000).optional()}).strict().refine(v=>!!(v.name||v.automationId),"Wait needs an exact name or automationId")),
  action("move",z.object(point).strict()),
  action("click",z.object({...point,button,count:z.number().int().min(1).max(3).optional()}).strict()),
  action("scroll",z.object({...point,dx:z.number().int().optional(),dy:z.number().int().optional()}).strict()),
  action("drag",z.object({fromX:point.x,fromY:point.y,toX:point.x,toY:point.y,button}).strict()),
  action("type_text",z.object({text:z.string()}).strict()),
  action("clipboard_set",z.object({text:z.string()}).strict()),
  action("key",z.object({keys:z.array(z.string()).min(1)}).strict()),
  action("invoke_element",z.object({elementId:z.string().min(1).optional(),selector:selectorSchema.optional()}).strict()
    .refine(v=>!!v.elementId!==!!v.selector,"Provide elementId or selector")),
  action("set_element_value",z.object({elementId:z.string().min(1),value:z.string()}).strict()),
]);
export const prepareSchema=z.object({id:z.string().optional(),actions:z.array(preparedActionSchema),
  flush:z.boolean().optional(),title:z.string().optional(),inputMode:z.enum(["block","ignore"]).optional()}).strict();
export const observeSchema=z.object({target:targetSchema,mode:z.enum(["combined","tree","image","targeted"]).optional(),
  query:z.string().optional(),depth:z.number().int().min(1).max(60).optional(),maxNodes:z.number().int().min(1).max(4000).optional()}).strict();
