-- Add UPDATE policy for cycle_logs restricted to workspace scope
CREATE POLICY "Users can update workspace logs" 
ON public.cycle_logs 
FOR UPDATE 
USING (workspace_id = get_user_workspace_id());

-- Add DELETE policy for cycle_logs restricted to workspace scope
CREATE POLICY "Users can delete workspace logs" 
ON public.cycle_logs 
FOR DELETE 
USING (workspace_id = get_user_workspace_id());