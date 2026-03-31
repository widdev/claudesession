DONE 1. Remove the 'clear' button from the Discussion/Messages panel. Replace with 'Archive'. This should present a dialog where the user can choose a location to save a text version of the entire chat history, and also select a checkbox to 'Clear on Save'. Add an Actions->Archive Discussion option which does the same

DONE 2. Add a new layout option under View to stack agents vertically.

DONE 3. Allow the Discussion panel to be made larger than 50% of the screen. Make the minimum size for both panels - shells and discussion, 20%

DONE 4. Add a new panel which is called 'Tasks'. The user can post tasks to this chat, just like in the messages window. Each task added should be given a unique but friendly ID, and the user should have the option to delete a task. The agents should be able to read from the tasks, so that at any point as a session manager I can say 'check for tasks' or '@Client - check task AB12'. Tasks can contain @ and # if necessary. The purpose is to give the session manage somewhere to queue up tasks and instructions while the agents are working. Ideally this panel can be dragged to dock, or made to float, so as to give more space. I would also like the ability to drag a task into the Discussion Input field to automatically copy the instruction into the chat

DONE 5. When in tab view for the shells, remove the circular + button. we don't really need it.

DONE 6. Settings->Rename Session is disabled (for a saved session?). It should be possible to rename a saved session at any time.

DONE 7. What is lost if I don't save a session? If the answer is nothing, then we should leave it disabled and not prompt the user when exiting. If there IS context which is lost, then we should allow a save — ANSWER: Messages, agent configs (names, IDs, working dirs), layout, and session name are all persisted in the session file. Without saving, these are lost. The save prompt on exit for unsaved sessions remains.



 

